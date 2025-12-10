"""
Integration backend (Flask) — Aadhaar + PAN + DL OCR, KYC integration, fraud pipeline stubs,
audit logs, MongoDB optional fallback.

Run: python integration_backend.py
Requires Tesseract installed at:
C:\\Program Files\\Tesseract-OCR\\tesseract.exe
(or set TESSERACT_PATH env var / PATH correctly)
"""

import io
import os
import logging
import re
from datetime import datetime
from datetime import timezone   # <<< ADDED
from typing import Optional, Dict, Any
from statistics import mean  # <<< ADDED
import uuid  # <<< ADDED
from collections import deque  # <<< ADDED

from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import numpy as np
import cv2

# Try importing pymongo; if missing, we'll use fallback in-memory DB
try:
    from pymongo import MongoClient
    from bson import ObjectId
    MONGO_AVAILABLE = True
except Exception:
    MONGO_AVAILABLE = False

# rapidfuzz for name similarity
try:
    from rapidfuzz import fuzz
except Exception:
    fuzz = None

# pytesseract for OCR
import pytesseract

# -------------------------
# Configure logging
# -------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("integration_backend")

# -------------------------
# Tesseract path (Windows default)
# -------------------------
TESSERACT_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
if os.path.exists(TESSERACT_PATH):
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH
else:
    env_path = os.environ.get("TESSERACT_PATH")
    if env_path:
        pytesseract.pytesseract.tesseract_cmd = env_path

logger.info("Using tesseract at: %s", pytesseract.pytesseract.tesseract_cmd)

# -------------------------
# Flask app
# -------------------------
app = Flask("integration_backend")
CORS(app)

# -------------------------
# MongoDB optional setup
# -------------------------
kyc_collection = None
verification_logs_collection = None
alerts_collection = None
if MONGO_AVAILABLE:
    try:
        mongo_uri = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
        db = client.get_database(os.environ.get("DB_NAME", "SecureKYC_DB"))
        kyc_collection = db.get_collection("kyc_records")
        verification_logs_collection = db.get_collection("verification_logs")
        alerts_collection = db.get_collection("fraud_alerts")
        client.admin.command("ping")  # test connection
        logger.info("Connected to MongoDB.")
    except Exception as e:
        logger.warning("MongoDB not available or failed to connect: %s", e)
        kyc_collection = None
        verification_logs_collection = None
        alerts_collection = None
else:
    logger.info("pymongo not installed — using in-memory fallback DBs.")

# In-memory fallback stores
fallback_db: list[dict] = []
fallback_logs: list[dict] = []
fallback_alerts: list[dict] = []

# -------------------------
# AUDIT TRAIL: in-memory store + helper
# -------------------------
AUDIT_EVENTS = deque(maxlen=500)  # newest events at top


def log_audit_event(event_type: str, title: str, message: str,
                    source: str = "System", meta: Optional[Dict[str, Any]] = None):
    """
    Add audit event for frontend AuditTrail.jsx.

    event_type: "success" | "warning" | "error" | "info"
    title: short title for the card
    message: one-line description
    source: where it came from ("Fraud Engine", "KYC Engine", etc.)
    meta: extra info (user_name, kyc_id, flags, etc.)
    """
    if meta is None:
        meta = {}

    evt = {
        "id": str(uuid.uuid4()),
        "type": event_type,
        "title": title,
        "message": message,
        "source": source,
        "timestamp": datetime.now(timezone.utc).isoformat(),  # React formats to DD-MM-YYYY hh:mm:ss AM/PM
        "meta": meta,
    }
    AUDIT_EVENTS.appendleft(evt)


# -------------------------
# Helpers
# -------------------------
def convert_obj(data):
    """Convert Mongo ObjectId to str recursively for JSON responses."""
    if isinstance(data, dict):
        return {k: convert_obj(v) for k, v in data.items()}
    if isinstance(data, list):
        return [convert_obj(v) for v in data]
    if MONGO_AVAILABLE and "ObjectId" in globals() and isinstance(data, ObjectId):
        return str(data)
    return data


def mask_aadhaar(aadhaar: str) -> str:
    if not aadhaar or len(re.sub(r"\D", "", aadhaar)) < 8:
        return aadhaar
    digits = re.sub(r"\D", "", aadhaar)
    return f"{digits[:4]}-XXXX-{digits[-4:]}"


def mask_pan(pan: str) -> str:
    if not pan or len(pan) < 10:
        return pan
    pn = re.sub(r"\s", "", pan)
    return f"{pn[:5]}-XX{pn[-2:]}"


def clean_person_name_strict(raw: Optional[str]) -> Optional[str]:
    """
    Clean person name:
      - Keep only letters (English + Devanagari) and spaces.
      - Drop leading tiny noise tokens like 'ane', 'ame', 'nam', etc.
      - Drop tiny tokens at the very end.
      - Drop trailing non-name tokens like 'holder', 'signature', etc.
    """
    if not raw:
        return None

    # Keep only letters & spaces
    s = re.sub(r"[^A-Za-z\u0900-\u097F\s]", " ", raw)
    s = re.sub(r"\s{2,}", " ", s).strip()
    if not s:
        return None

    parts = s.split()

    # Drop leading noise tokens (like "ane", "ame", "nam") if we have a full name
    while len(parts) >= 3:
        first = parts[0]
        fl = first.lower()
        if fl in {"ane", "ame", "nam", "name"} or fl.startswith("nam"):
            parts.pop(0)
            continue
        # Generic rule: if first token length <= 3 and we still have >= 3 tokens,
        # treat it as noise (this will drop "ane PRITI SAMADHAN ..." -> "PRITI SAMADHAN ...")
        if len(first) <= 3:
            parts.pop(0)
            continue
        break

    # Build clean_parts but stop on tiny tokens near the end
    clean_parts = []
    for i, p in enumerate(parts):
        if len(p) <= 2 and len(clean_parts) >= 2:
            # e.g. stop before stray "s" from "Holder's"
            break
        clean_parts.append(p)

    # Drop small leading noise if we somehow still have it
    while len(clean_parts) > 3 and len(clean_parts[0]) <= 2:
        clean_parts.pop(0)

    # Drop trailing non-name tokens like "holder", "signature"
    tail_noise = {"holder", "signature", "sign", "signatory", "photo", "card"}
    while len(clean_parts) > 1 and clean_parts[-1].lower() in tail_noise:
        clean_parts.pop()

    if not clean_parts:
        return None

    return " ".join(clean_parts)


def is_mostly_english(text: str, threshold: float = 0.7) -> bool:
    """Return True if most letters are A–Z/a–z (to avoid Marathi/Hindi noise lines)."""
    if not text:
        return False
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return False
    latin = [ch for ch in letters if re.match(r"[A-Za-z]", ch)]
    return (len(latin) / len(letters)) >= threshold

# -------------------------
# Image preprocessing & OCR helpers
# -------------------------
def pil_from_stream(file_stream) -> Image.Image:
    file_stream.seek(0)
    img = Image.open(file_stream).convert("RGB")
    return img


def preprocess_for_ocr(pil_img: Image.Image) -> Image.Image:
    """Improve contrast, denoise, upscale, threshold — return PIL image."""
    arr = np.array(pil_img)
    try:
        img_cv = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    except Exception:
        img_cv = arr
    h, w = img_cv.shape[:2]

    scale = 1.0
    if max(h, w) < 1200:
        scale = 1.6
    new_w, new_h = int(w * scale), int(h * scale)
    img_cv = cv2.resize(img_cv, (new_w, new_h), interpolation=cv2.INTER_CUBIC)

    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)

    # CLAHE
    try:
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
    except Exception:
        pass

    gray = cv2.bilateralFilter(gray, 9, 75, 75)
    gaussian = cv2.GaussianBlur(gray, (9, 9), 10.0)
    gray = cv2.addWeighted(gray, 1.5, gaussian, -0.5, 0)

    th = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 9
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, kernel)

    return Image.fromarray(th)


def ocr_with_fallback(pil_image: Image.Image, lang="eng") -> str:
    """Try several pytesseract configs and return best non-empty string."""
    configs = ["--oem 3 --psm 6", "--oem 1 --psm 6", "--oem 1 --psm 3", "--oem 1 --psm 7"]
    for cfg in configs:
        try:
            txt = pytesseract.image_to_string(pil_image, lang=lang, config=cfg)
            txt = "\n".join([ln.strip() for ln in txt.splitlines() if ln.strip()])
            if len(txt) >= 3:
                return txt
        except Exception:
            continue
    try:
        txt = pytesseract.image_to_string(pil_image, lang=lang)
        return "\n".join([ln.strip() for ln in txt.splitlines() if ln.strip()])
    except Exception:
        return ""

# -------------------------
# Parsers for Aadhaar, PAN, DL
# -------------------------
def parse_aadhaar(raw_text: str) -> Dict[str, Optional[str]]:
    """
    Aadhaar parser focused on clean NAME + DOB + GENDER + NUMBER.
    """
    out = {
        "raw_text": raw_text,
        "name": None,
        "dob": None,
        "gender": None,
        "aadhaar_number": None,
    }
    if not raw_text:
        return out

    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]

    # -------- Aadhaar number --------
    aadhaar_re = re.compile(r"(\d{4}\s*\d{4}\s*\d{4})")
    for ln in lines:
        m = aadhaar_re.search(ln)
        if m:
            out["aadhaar_number"] = re.sub(r"\s+", "", m.group(1))
            break

    # -------- DOB --------
    dob_idx = None
    dob_re = re.compile(r"\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b")
    for idx, ln in enumerate(lines):
        m = dob_re.search(ln)
        if m:
            out["dob"] = m.group(1)
            dob_idx = idx
            break

    # -------- Gender --------
    for ln in lines:
        g_match = re.search(
            r"\b(Male|MALE|Female|FEMALE|Transgender|OTHER|OTHERS)\b", ln
        )
        if g_match:
            out["gender"] = g_match.group(0)
            break

    # -------- Name --------
    name_candidates = []
    skip_kw = re.compile(
        r"\b(GOVERNMENT|INDIA|AADHAAR|UNIQUE|IDENTITY|ADDRESS|DOB|DATE|MOBILE|VID|MAAZE|MADHE|UNION)\b",
        re.IGNORECASE,
    )

    # 1) same-line "Name: ..."
    for idx, ln in enumerate(lines):
        if skip_kw.search(ln):
            continue
        if "name" in ln.lower() or "नाम" in ln:
            m = re.search(r"[Nn]ame[^:]*[:\-]\s*(.+)", ln)
            if not m:
                m = re.search(r"नाम[:\-]?\s*(.+)", ln)
            if m:
                cand = clean_person_name_strict(m.group(1))
                if (
                    cand
                    and len(cand.split()) >= 2
                    and len(cand) >= 5
                    and is_mostly_english(cand)
                ):
                    name_candidates.append(("label_same_line", idx, cand))

    # 2) line above DOB
    if dob_idx is not None:
        for look_up in range(1, 4):
            i = dob_idx - look_up
            if i < 0:
                break
            ln = lines[i]
            if skip_kw.search(ln):
                continue
            if any(ch.isdigit() for ch in ln):
                continue
            cand = clean_person_name_strict(ln)
            if (
                cand
                and len(cand.split()) >= 2
                and len(cand) >= 5
                and is_mostly_english(cand)
            ):
                name_candidates.append(("above_dob", i, cand))
                break

    # 3) fallback
    if not name_candidates:
        for idx, ln in enumerate(lines):
            if skip_kw.search(ln):
                continue
            if any(ch.isdigit() for ch in ln):
                continue
            cand = clean_person_name_strict(ln)
            if (
                cand
                and len(cand.split()) >= 2
                and len(cand) >= 5
                and is_mostly_english(cand)
            ):
                name_candidates.append(("fallback", idx, cand))

    best_name = None
    best_score = -1
    weight_by_source = {"label_same_line": 3, "above_dob": 2, "fallback": 1}
    for source, idx, cand in name_candidates:
        score = weight_by_source.get(source, 1) * 100 + len(cand)
        if score > best_score:
            best_score = score
            best_name = cand

    out["name"] = best_name
    return out


def parse_pan(raw_text: str) -> Dict[str, Optional[str]]:
    out = {
        "raw_text": raw_text,
        "name": None,
        "father_name": None,
        "dob": None,
        "pan_number": None,
    }
    if not raw_text:
        return out

    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]

    pan_re = re.compile(r"([A-Z]{5}\s*[0-9]{4}\s*[A-Z])", re.IGNORECASE)
    pan_idx = None
    for i, ln in enumerate(lines):
        compact = re.sub(r"\s+", "", ln)
        m = pan_re.search(compact)
        if m:
            out["pan_number"] = m.group(1).upper().replace(" ", "")
            pan_idx = i
            break

    dob_re = re.compile(r"\b(\d{2}[\/-]\d{2}[\/-]\d{4})\b")
    for ln in lines:
        m = dob_re.search(ln)
        if m:
            out["dob"] = m.group(1)
            break

    name_label = None
    father_label = None
    for idx, ln in enumerate(lines):
        low = ln.lower()
        if ("name" in low and "father" not in low) or ("नाम" in ln and "पिता" not in ln):
            if name_label is None:
                name_label = idx
        if ("father" in low) or ("पिता" in ln) or ("father's name" in low):
            if father_label is None:
                father_label = idx

    def clean_candidate(s: str) -> Optional[str]:
        if not s:
            return None
        return clean_person_name_strict(s)

    if name_label is not None and name_label + 1 < len(lines):
        cand = clean_candidate(lines[name_label + 1])
        if cand and len(cand) >= 3:
            out["name"] = cand

    if father_label is not None and father_label + 1 < len(lines):
        cand = clean_candidate(lines[father_label + 1])
        if cand and len(cand) >= 3:
            out["father_name"] = cand

    def pick_alpha(cands):
        noise = re.compile(
            r"\b(PAN|INCOME|TAX|GOVT|GOVERNMENT|PERMANENT|ACCOUNT|INDIA|DOB|DATE|PHOTO)\b",
            re.IGNORECASE,
        )
        filtered = []
        for s in cands:
            if not s:
                continue
            if noise.search(s):
                continue
            alpha_count = sum(1 for ch in s if ch.isalpha())
            if alpha_count < 4:
                continue
            c = clean_candidate(s)
            if c:
                filtered.append(c)
        if not filtered:
            return None
        return max(filtered, key=lambda x: len(x))

    if not out["name"]:
        if pan_idx is not None:
            above = lines[max(0, pan_idx - 4): pan_idx]
            below = lines[pan_idx + 1: pan_idx + 5]
            out["name"] = (
                pick_alpha(list(reversed(above)))
                or pick_alpha(above)
                or pick_alpha(below)
            )
        else:
            uppercase_lines = [
                ln
                for ln in lines
                if re.search(r"[A-Z]{2,}", ln)
                and len(re.sub(r"[^A-Za-z\u0900-\u097F ]", "", ln)) > 3
            ]
            if uppercase_lines:
                out["name"] = clean_candidate(uppercase_lines[0])

    if not out["father_name"]:
        if pan_idx is not None:
            above = lines[max(0, pan_idx - 6): pan_idx]
            below = lines[pan_idx + 1: pan_idx + 6]
            out["father_name"] = pick_alpha(below) or pick_alpha(above)

    if (
        out.get("name")
        and out.get("father_name")
        and out["name"].strip().lower() == out["father_name"].strip().lower()
    ):
        out["father_name"] = None

    return out


# -------------------------
# DL PARSER (tolerant; with Issue/Validity)
# -------------------------
def parse_dl(raw_text: str) -> Dict[str, Optional[str]]:
    """
    Driving Licence parser (very tolerant).
    Extracts: name, dob, dl_number, address, issue_date, valid_till.
    """
    out = {
        "raw_text": raw_text,
        "name": None,
        "dob": None,
        "dl_number": None,
        "address": None,
        "issue_date": None,
        "valid_till": None,
    }
    if not raw_text:
        return out

    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    full = " ".join(lines)

    # ---------- DL NUMBER ----------
    dl_no = None
    m = re.search(r"\bDL[^0-9A-Za-z]{0,3}\d{1,2}[^0-9A-Za-z]{0,3}\d{4,}\b", full, re.IGNORECASE)
    if m:
        dl_no = m.group(0)

    if not dl_no:
        best_digits = None
        for dm in re.finditer(r"\d{9,16}", re.sub(r"\s", "", full)):
            cand = dm.group(0)
            if len(cand) == 8:  # likely ddmmyyyy
                continue
            if best_digits is None or len(cand) > len(best_digits):
                best_digits = cand
        dl_no = best_digits

    if dl_no:
        digits_only = re.sub(r"\D", "", dl_no)
        if len(digits_only) >= 9:
            dl_no = digits_only

    out["dl_number"] = dl_no

    # ---------- DATE HELPERS ----------
    def normalize_date_str(s: str) -> Optional[str]:
        digits = re.sub(r"\D", "", s)
        if len(digits) == 8:      # ddmmyyyy
            d, m, y = digits[0:2], digits[2:4], digits[4:8]
        elif len(digits) == 6:    # ddmmyy -> 20yy
            d, m, y = digits[0:2], digits[2:4], "20" + digits[4:6]
        else:
            return None
        try:
            datetime(int(y), int(m), int(d))
            return f"{d}-{m}-{y}"
        except Exception:
            return None

    def date_key(ds: str):
        d, m, y = ds.split("-")
        try:
            return int(y), int(m), int(d)
        except Exception:
            return (9999, 12, 31)

    # ---------- TARGETED: DOB / ISSUE / VALIDITY lines ----------
    dob_candidates = []
    issue_candidates = []
    valid_candidates = []

    date_any = re.compile(r"\d{1,2}[-/:\.\s]\d{1,2}[-/:\.\s]\d{2,4}|\b\d{8}\b")

    for idx, ln in enumerate(lines):
        low = ln.lower()
        for dm in date_any.finditer(ln):
            norm = normalize_date_str(dm.group(0))
            if not norm:
                continue
            if "birth" in low or "dob" in low:
                dob_candidates.append((idx, norm))
            elif "issue" in low:
                issue_candidates.append((idx, norm))
            elif "valid" in low or "validity" in low or "till" in low:
                valid_candidates.append((idx, norm))

    if dob_candidates:
        out["dob"] = dob_candidates[0][1]

    if issue_candidates:
        issue_dates = sorted({d for _, d in issue_candidates}, key=date_key)
        out["issue_date"] = issue_dates[0]

    if valid_candidates:
        valid_dates = sorted({d for _, d in valid_candidates}, key=date_key)
        out["valid_till"] = valid_dates[-1]

    # ---------- FALLBACK: global date ordering ----------
    if not (out["dob"] and out["issue_date"] and out["valid_till"]):
        date_sep_re = re.compile(r"\d{1,2}[-/:\.\s]\d{1,2}[-/:\.\s]\d{2,4}")
        date_plain_re = re.compile(r"\b\d{8}\b")
        all_dates = []

        for idx, ln in enumerate(lines):
            low = ln.lower()
            for dm in date_sep_re.finditer(ln):
                norm = normalize_date_str(dm.group(0))
                if not norm:
                    continue
                all_dates.append((idx, low, norm))
            for dm in date_plain_re.finditer(ln):
                norm = normalize_date_str(dm.group(0))
                if not norm:
                    continue
                all_dates.append((idx, low, norm))

        if all_dates:
            uniq = sorted({d for (_, _, d) in all_dates}, key=date_key)
            if len(uniq) == 1:
                if not out["dob"]:
                    out["dob"] = uniq[0]
            elif len(uniq) == 2:
                if not out["dob"]:
                    out["dob"] = uniq[0]
                if not out["valid_till"]:
                    out["valid_till"] = uniq[1]
            else:
                if not out["dob"]:
                    out["dob"] = uniq[0]
                if not out["issue_date"]:
                    out["issue_date"] = uniq[1]
                if not out["valid_till"]:
                    out["valid_till"] = uniq[-1]

    # ---------- NAME ----------
    name_candidates = []

    def is_noise_for_name(text: str) -> bool:
        return bool(
            re.search(
                r"\b(licen|licence|driving|union|india|issued|department|transport|"
                r"blood|group|organ|donor|valid|date|issue|son|daughter|wife|"
                r"s\/o|d\/o|w\/o|address|signature|government|ministry|republic)\b",
                text,
                re.IGNORECASE,
            )
        )

    # 1) "Name: XYZ" from full text
    m = re.search(
        r"[Nn]ame[^A-Za-z0-9]{0,5}([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F\s]{3,50})",
        full,
    )
    if m:
        cand = clean_person_name_strict(m.group(1))
        if cand and len(cand.split()) >= 2 and len(cand) >= 5 and is_mostly_english(cand):
            out["name"] = cand

    # 2) line-based fallbacks
    if out["name"] is None:
        for idx, ln in enumerate(lines):
            low = ln.lower()
            if "name" in low:
                m2 = re.search(r"[Nn]ame[^:]*[:\-]\s*(.+)", ln)
                if m2:
                    cand = clean_person_name_strict(m2.group(1))
                    if cand and len(cand.split()) >= 2 and is_mostly_english(cand):
                        name_candidates.append(("label_same_line", idx, cand))

        if not name_candidates:
            label_idx = None
            for idx, ln in enumerate(lines):
                low = ln.lower()
                if "name" in low and "father" not in low and "guardian" not in low:
                    label_idx = idx
                    break
            if label_idx is not None and label_idx + 1 < len(lines):
                ln = lines[label_idx + 1]
                if not is_noise_for_name(ln):
                    cand = clean_person_name_strict(ln)
                    if cand and len(cand.split()) >= 2 and is_mostly_english(cand):
                        name_candidates.append(("label_next_line", label_idx + 1, cand))

        if not name_candidates:
            for idx, ln in enumerate(lines):
                if is_noise_for_name(ln):
                    continue
                if any(ch.isdigit() for ch in ln):
                    continue
                if sum(1 for ch in ln if ch.isalpha()) < 4:
                    continue
                cand = clean_person_name_strict(ln)
                if cand and len(cand.split()) >= 2 and is_mostly_english(cand):
                    name_candidates.append(("global", idx, cand))

        if name_candidates:
            weight = {"label_same_line": 4, "label_next_line": 3, "global": 1}
            best_name = None
            best_score = -1
            for source, idx, cand in name_candidates:
                score = weight.get(source, 1) * 100 + len(cand)
                if score > best_score:
                    best_score = score
                    best_name = cand
            out["name"] = best_name

    # ---------- ADDRESS ----------
    addr_idx = None
    for idx, ln in enumerate(lines):
        if "address" in ln.lower():
            addr_idx = idx
            break
    if addr_idx is not None and addr_idx + 1 < len(lines):
        addr_lines = []
        for ln in lines[addr_idx + 1: addr_idx + 6]:
            low = ln.lower()
            if "dob" in low or "birth" in low or "blood" in low or "valid" in low or "issue" in low:
                break
            addr_lines.append(ln)
        if addr_lines:
            addr = " ".join(addr_lines)
            addr = re.sub(r"\s{2,}", " ", addr).strip()
            out["address"] = addr

    return out

# -------------------------
# ROI-based OCR wrapper (for Aadhaar & PAN)
# -------------------------
def ocr_try_rois_and_parse(file_stream, parser_fn, lang="eng") -> Dict[str, Any]:
    """
    file_stream: file.stream or PIL.Image or bytes
    parser_fn: parse_aadhaar, parse_pan, parse_dl
    Returns best_parsed, raw, debug
    """
    if hasattr(file_stream, "read"):
        file_stream.seek(0)
        pil = Image.open(file_stream).convert("RGB")
    elif isinstance(file_stream, Image.Image):
        pil = file_stream.convert("RGB")
    else:
        pil = Image.open(io.BytesIO(file_stream)).convert("RGB")

    w, h = pil.size
    rois = [
        ("whole", (0, 0, w, h)),
        ("top_half", (0, 0, w, h // 2)),
        ("bottom_half", (0, h // 2, w, h)),
        ("left_half", (0, 0, w // 2, h)),
        ("right_half", (w // 2, 0, w, h)),
        ("center_band", (int(w * 0.05), int(h * 0.18), int(w * 0.95), int(h * 0.62))),
        ("top_left_quadrant", (0, 0, int(w * 0.6), int(h * 0.45))),
        ("right_of_photo", (int(w * 0.35), int(h * 0.15), int(w * 0.98), int(h * 0.55))),
        ("bottom_strip", (0, int(h * 0.6), w, h)),
    ]

    best_score = -1
    best_parsed = None
    best_raw = ""
    debug = []
    for label, bbox in rois:
        try:
            cropped = pil.crop(bbox)
            pre = preprocess_for_ocr(cropped)
            txt = ocr_with_fallback(pre, lang=lang)
            parsed = parser_fn(txt)
            score = 0
            if parser_fn == parse_aadhaar:
                if parsed.get("aadhaar_number"):
                    score += 200
                if parsed.get("dob"):
                    score += 180
                if parsed.get("gender"):
                    score += 90
                if parsed.get("name"):
                    score += 80
            elif parser_fn == parse_pan:
                if parsed.get("pan_number"):
                    score += 200
                if parsed.get("dob"):
                    score += 80
                if parsed.get("name"):
                    score += 60
                if parsed.get("father_name"):
                    score += 40
            else:  # DL
                if parsed.get("dl_number"):
                    score += 200
                if parsed.get("issue_date"):
                    score += 120
                if parsed.get("valid_till"):
                    score += 120
                if parsed.get("dob"):
                    score += 60
                if parsed.get("name"):
                    score += 80
            score += min(len(txt), 600) // 6
            debug.append(
                {
                    "roi": label,
                    "bbox": bbox,
                    "score": score,
                    "parsed": parsed,
                    "text_snippet": txt[:800],
                }
            )
            if score > best_score:
                best_score = score
                best_parsed = parsed
                best_raw = txt
        except Exception as e:
            logger.exception("ROI failed %s: %s", label, e)

    if best_parsed is None:
        best_parsed = {"raw_text": "", "error": "no-ocr"}

    # Merge critical fields from all ROIs if missing
    if parser_fn == parse_aadhaar:
        keys = ["aadhaar_number", "name", "dob", "gender"]
        for key in keys:
            if not best_parsed.get(key):
                for d in debug:
                    v = d["parsed"].get(key)
                    if v:
                        best_parsed[key] = v
                        break

    return {
        "best_parsed": best_parsed,
        "best_raw": best_raw,
        "debug": debug,
        "best_score": best_score,
    }

# -------------------------
# FULL-IMAGE OCR for DL ONLY
# -------------------------
def ocr_dl_full(file_stream) -> Dict[str, Any]:
    """
    Driving License OCR:
    - Use BOTH preprocessed and original image.
    - Run OCR on each, keep whichever text is longer.
    - Then parse with parse_dl.
    """
    if hasattr(file_stream, "read"):
        file_stream.seek(0)
        pil = Image.open(file_stream).convert("RGB")
    elif isinstance(file_stream, Image.Image):
        pil = file_stream.convert("RGB")
    else:
        pil = Image.open(io.BytesIO(file_stream)).convert("RGB")

    # preprocessed
    pre = preprocess_for_ocr(pil)
    txt_pre = ocr_with_fallback(pre, lang="eng")

    # original
    txt_raw = ocr_with_fallback(pil, lang="eng")

    txt_candidates = [txt_pre, txt_raw]
    txt = max(txt_candidates, key=lambda t: len(t or "")) or ""

    print("\n===== DL RAW TEXT (CHOSEN) =====\n", txt, "\n====================================\n")

    parsed = parse_dl(txt)

    print("===== DL PARSED DATA =====\n", parsed, "\n===========================\n")

    return {
        "best_parsed": parsed,
        "best_raw": txt,
        "debug": [],
        "best_score": 999,
    }


# -------------------------
# Name similarity utility
# -------------------------
def name_similarity_score(a: Optional[str], b: Optional[str]) -> Dict[str, Optional[float]]:
    """
    Compare two names:

    - If spelling is identical ignoring case / extra spaces / punctuation,
      immediately mark as VERIFIED (score 100).
    - Otherwise fall back to RapidFuzz (if available) or simple logic.
    """
    if not a and not b:
        return {"score": None, "status": "unknown"}

    if not a or not b:
        return {"score": 40.0, "status": "review"}

    def norm_equal(x: str) -> str:
        x = x.strip()
        x = re.sub(r"[^A-Za-z\u0900-\u097F\s]", " ", x)
        x = re.sub(r"\s+", " ", x)
        return x.lower()

    na = norm_equal(a)
    nb = norm_equal(b)

    if na and nb and na == nb:
        return {"score": 100.0, "status": "verified"}

    if fuzz is None:
        s = 100.0 if a.strip().lower() == b.strip().lower() else 60.0
        status = "verified" if s >= 85 else ("review" if s >= 60 else "mismatch")
        return {"score": s, "status": status}

    s1 = fuzz.token_set_ratio(a, b)
    s2 = fuzz.partial_ratio(a, b)
    score = round(0.6 * s1 + 0.4 * s2, 2)

    if score >= 85:
        status = "verified"
    elif score >= 60:
        status = "review"
    else:
        status = "mismatch"

    return {"score": score, "status": status}

# -------------------------
# DOB similarity helpers
# -------------------------
def dob_digits_only(d: str) -> str:
    return re.sub(r"\D", "", d or "")


def dob_distance(a: str, b: str) -> int:
    da = dob_digits_only(a)
    db = dob_digits_only(b)
    if not da or not db or len(da) != len(db):
        return 99
    return sum(1 for x, y in zip(da, db) if x != y)


def dob_near_equal(a: str, b: str, max_diff: int = 1) -> bool:
    if not a or not b:
        return False
    return dob_distance(a, b) <= max_diff


# -------------------------
# Mock face matcher
# -------------------------
def mock_face_embedding(pil_img: Image.Image):
    arr = np.array(pil_img.convert("L").resize((64, 64)), dtype=np.float32)
    v = arr.mean(axis=1)
    v = (v - v.mean()) / (v.std() + 1e-9)
    return v.flatten()


def cosine_sim(a, b):
    a = np.asarray(a, dtype=np.float32)
    b = np.asarray(b, dtype=np.float32)
    denom = np.linalg.norm(a) * np.linalg.norm(b) + 1e-9
    return float(np.dot(a, b) / denom)


def face_match_scores(img1: Image.Image, img2: Image.Image):
    try:
        e1 = mock_face_embedding(img1)
        e2 = mock_face_embedding(img2)
        sim = cosine_sim(e1, e2)
        score = round(sim * 100.0, 2)
        return {"score": score, "matched": score >= 70.0}
    except Exception as e:
        logger.exception("face_match failed: %s", e)
        return {"score": None, "matched": False}

# -------------------------
# Record creation helpers
# -------------------------
def make_record(
    user_name,
    aadhaar_masked,
    pan_masked,
    aadhaar_ocr=None,
    pan_ocr=None,
    verification=None,
    fraud_result=None,
    dob=None,
    gender=None,
):
    rec = {
        "user_name": user_name,
        "aadhaar_masked": aadhaar_masked,
        "pan_masked": pan_masked,
        "aadhaar_ocr": aadhaar_ocr or {},
        "pan_ocr": pan_ocr or {},
        "verification_result": verification or {},
        "fraud_result": fraud_result or {},
        "status": "Pending",
        "timestamp": datetime.now().isoformat(),
    }
    if dob:
        rec["dob"] = dob
    if gender:
        rec["gender"] = gender
    return rec


# ---------- NEW: FRAUD RESULT BUILDER FOR NEW KYC RECORDS ----------
def compute_fraud_result_for_new_kyc(
    rec: Dict[str, Any],
    existing_records: list[dict],
    similarity_status: Optional[str],
) -> Dict[str, Any]:
    fraud_score = 0
    code_flags: list[str] = []
    reason_texts: list[str] = []

    user_name = (rec.get("user_name") or "").strip().lower()
    aad_mask = rec.get("aadhaar_masked")
    pan_mask = rec.get("pan_masked")

    duplicate_submission = False
    duplicate_aadhaar = False
    duplicate_pan = False

    for old in existing_records:
        if not old:
            continue
        old_user = (old.get("user_name") or "").strip().lower()
        old_aad = old.get("aadhaar_masked")
        old_pan = old.get("pan_masked")

        if aad_mask and old_aad and aad_mask == old_aad:
            duplicate_aadhaar = True
            if user_name and old_user == user_name:
                duplicate_submission = True

        if pan_mask and old_pan and pan_mask == old_pan:
            duplicate_pan = True
            if user_name and old_user == user_name:
                duplicate_submission = True

    if duplicate_submission:
        fraud_score += 30
        code_flags.append("duplicate_submission")
        reason_texts.append("Duplicate submission detected")

    if duplicate_aadhaar:
        fraud_score += 20
        code_flags.append("duplicate_aadhaar")
        reason_texts.append("Duplicate Aadhaar detected")

    if duplicate_pan:
        fraud_score += 20
        code_flags.append("duplicate_pan")
        reason_texts.append("Duplicate PAN detected")

    if (duplicate_aadhaar or duplicate_pan) and "aadhaar_pan_duplicate" not in code_flags:
        code_flags.append("aadhaar_pan_duplicate")
        reason_texts.append("Aadhaar/PAN matches an existing record (duplicate)")

    if similarity_status:
        st = similarity_status.lower()
        if st == "mismatch":
            fraud_score += 25
            code_flags.append("name_mismatch")
            reason_texts.append("Name on document does not closely match user input")
        elif st == "review":
            fraud_score += 10
            code_flags.append("name_partial_match")
            reason_texts.append("Name partially matches – manual review recommended")
        elif st == "verified":
            reason_texts.append("Name on Aadhaar and PAN consistent with user input")

    fraud_score = max(0, min(100, fraud_score))

    if fraud_score >= 70:
        risk_level = "HIGH"
    elif fraud_score >= 35:
        risk_level = "MEDIUM"
        code_flags.append("name_partial_match")
        reason_texts.append("Name partially matches – manual review recommended")
    elif st == "verified":
        reason_texts.append("Name on Aadhaar and PAN consistent with user input")

    fraud_score = max(0, min(100, fraud_score))

    if fraud_score >= 70:
        risk_level = "HIGH"
    elif fraud_score >= 35:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    if risk_level == "HIGH":
        confidence = 90
    elif risk_level == "MEDIUM":
        confidence = 85
    else:
        confidence = 80

    if not reason_texts and risk_level == "LOW":
        reason_texts.append("No anomalies detected for this KYC submission")

    return {
        "fraud_score": fraud_score,
        "risk_level": risk_level,
        "flags": code_flags,
        "flags_text": ", ".join(reason_texts),
        "confidence": confidence,
    }

# -------------------------
# Seed demo data
# -------------------------
def seed_demo():
    if kyc_collection is not None:
        try:
            if kyc_collection.count_documents({}) == 0:
                demo = make_record(
                    "Demo User",
                    "1234-XXXX-5678",
                    "ABCDE-XX12Z",
                    aadhaar_ocr={
                        "name": "Demo User",
                        "dob": "01/01/1980",
                        "aadhaar_number": "123456785678",
                    },
                    pan_ocr={
                        "name": "DEMO USER",
                        "father_name": "FATHER NAME",
                        "pan_number": "ABCDE1234Z",
                    },
                    verification={
                        "similarity_score": 95,
                        "similarity_status": "verified",
                    },
                    fraud_result={},
                    dob="01/01/1980",
                    gender="MALE",
                )

                demo["fraud_result"] = compute_fraud_result_for_new_kyc(
                    demo,
                    existing_records=[],
                    similarity_status="verified",
                )

                kyc_collection.insert_one(demo)
                logger.info("Seeded demo document in MongoDB.")
        except Exception as e:
            logger.exception("Failed seeding demo to mongo: %s", e)
    else:
        if len(fallback_db) == 0:
            rec = make_record(
                "Demo User",
                "1234-XXXX-5678",
                "ABCDE-XX12Z",
                aadhaar_ocr={
                    "name": "Demo User",
                    "dob": "01/01/1980",
                    "aadhaar_number": "123456785678",
                },
                pan_ocr={
                    "name": "DEMO USER",
                    "father_name": "FATHER NAME",
                    "pan_number": "ABCDE1234Z",
                },
                verification={
                    "similarity_score": 95,
                    "similarity_status": "verified",
                },
                fraud_result={},
                dob="01/01/1980",
                gender="MALE",
            )

            rec["fraud_result"] = compute_fraud_result_for_new_kyc(
                rec,
                existing_records=[],
                similarity_status="verified",
            )

            rec["_id"] = "local-1"
            fallback_db.append(rec)
            logger.info("Seeded demo record in fallback DB.")


seed_demo()

# -------------------------
# Health route
# -------------------------
@app.route("/", methods=["GET"])
def home():
    return jsonify({"message": "Integration Backend Running"}), 200

# -------------------------
# API endpoints
# -------------------------
@app.route("/extract_aadhaar", methods=["POST"])
def extract_aadhaar_api():
    try:
        if "aadhaar" not in request.files:
            return jsonify({"error": "aadhaar file missing"}), 400
        file = request.files["aadhaar"]
        logger.info("Received Aadhaar file: %s", file.filename)
        out = ocr_try_rois_and_parse(file.stream, parse_aadhaar, lang="eng+hin")
        return (
            jsonify(
                {
                    "extracted_data": out["best_parsed"],
                    "raw_text": out["best_raw"],
                    "debug": out["debug"],
                    "score": out["best_score"],
                }
            ),
            200,
        )
    except Exception as e:
        logger.exception("extract_aadhaar failed")
        return jsonify({"error": str(e)}), 500


@app.route("/extract_pan", methods=["POST"])
def extract_pan_api():
    try:
        if "pan" not in request.files:
            return jsonify({"error": "pan file missing"}), 400
        file = request.files["pan"]
        logger.info("Received PAN file: %s", file.filename)
        out = ocr_try_rois_and_parse(file.stream, parse_pan, lang="eng")
        return (
            jsonify(
                {
                    "extracted_data": out["best_parsed"],
                    "raw_text": out["best_raw"],
                    "debug": out["debug"],
                    "score": out["best_score"],
                }
            ),
            200,
        )
    except Exception as e:
        logger.exception("extract_pan failed")
        return jsonify({"error": str(e)}), 500


@app.route("/extract_dl", methods=["POST"])
def extract_dl_api():
    try:
        if "driving_license" not in request.files and "dl" not in request.files:
            return jsonify({"error": "driving_license file missing"}), 400

        file = request.files.get("driving_license") or request.files.get("dl")
        logger.info("Received Driving License file: %s", file.filename)

        out = ocr_dl_full(file.stream)
        return (
            jsonify(
                {
                    "extracted_data": out["best_parsed"],
                    "raw_text": out["best_raw"],
                    "debug": out["debug"],
                    "score": out["best_score"],
                }
            ),
            200,
        )
    except Exception as e:
        logger.exception("extract_dl failed")
        return jsonify({"error": str(e)}), 500


@app.route("/validate_document", methods=["POST"])
def validate_document():
    try:
        doc_type = request.form.get("doc_type") or request.args.get("doc_type")
        if not doc_type:
            return jsonify({"error": "doc_type missing (aadhaar|pan)"}), 400
        file = request.files.get("file") or request.files.get(doc_type)
        if not file:
            return jsonify({"error": "file missing"}), 400
        if doc_type.lower() == "aadhaar":
            out = ocr_try_rois_and_parse(file.stream, parse_aadhaar, lang="eng+hin")
        else:
            out = ocr_try_rois_and_parse(file.stream, parse_pan, lang="eng")
        return (
            jsonify(
                {
                    "parsed": out["best_parsed"],
                    "raw": out["best_raw"],
                    "debug": out["debug"],
                }
            ),
            200,
        )
    except Exception as e:
        logger.exception("validate_document failed")
        return jsonify({"error": str(e)}), 500


@app.route("/verify_identity", methods=["POST"])
def verify_identity():
    try:
        user_name = request.form.get("user_name")
        aadhaar_file = request.files.get("aadhaar")
        pan_file = request.files.get("pan")
        selfie_file = request.files.get("selfie")

        aadhaar_parsed = {}
        pan_parsed = {}
        debug = {}

        if aadhaar_file:
            aad = ocr_try_rois_and_parse(
                aadhaar_file.stream, parse_aadhaar, lang="eng+hin"
            )
            aadhaar_parsed = aad["best_parsed"]
            debug["aadhaar_debug"] = aad["debug"]
        if pan_file:
            panr = ocr_try_rois_and_parse(pan_file.stream, parse_pan, lang="eng")
            pan_parsed = panr["best_parsed"]
            debug["pan_debug"] = panr["debug"]

        name_checks = {}
        if user_name and aadhaar_parsed.get("name"):
            name_checks["user_vs_aadhaar"] = name_similarity_score(
                user_name, aadhaar_parsed.get("name")
            )
        if user_name and pan_parsed.get("name"):
            name_checks["user_vs_pan"] = name_similarity_score(
                user_name, pan_parsed.get("name")
            )
        if aadhaar_parsed.get("name") and pan_parsed.get("name"):
            name_checks["aadhaar_vs_pan"] = name_similarity_score(
                aadhaar_parsed.get("name"), pan_parsed.get("name")
            )

        face_res = {"score": None, "matched": False}
        try:
            if selfie_file and (aadhaar_file or pan_file):
                id_file = pan_file or aadhaar_file
                selfie_img = Image.open(selfie_file.stream).convert("RGB")
                id_img = Image.open(id_file.stream).convert("RGB")
                face_res = face_match_scores(selfie_img, id_img)
        except Exception as e:
            logger.exception("face matching failed: %s", e)

        identity_verified = (
            any((v.get("score") or 0) >= 85 for v in name_checks.values())
            if name_checks
            else False
        )
        response = {
            "user_name": user_name,
            "aadhaar_parsed": aadhaar_parsed,
            "pan_parsed": pan_parsed,
            "name_checks": name_checks,
            "face_match": face_res,
            "identity_verified": identity_verified,
            "debug": debug,
        }

        log_record = {
            "timestamp": datetime.now().isoformat(),
            "user_name": user_name,
            "identity_verified": identity_verified,
            "name_checks": name_checks,
            "face_match": face_res,
        }
        if verification_logs_collection is not None:
            verification_logs_collection.insert_one(log_record)
        else:
            fallback_logs.append(log_record)

        return jsonify(response), 200
    except Exception as e:
        logger.exception("verify_identity failed")
        return jsonify({"error": str(e)}), 500


@app.route("/analyze", methods=["POST"])
def analyze():
    """
    Used by frontend 'Verify with AI' button.
    DL DOB is intentionally ignored in DOB consistency / fraud checks.
    """
    try:
        form = request.form

        user_name = (form.get("user_name") or "").strip()
        dob_input = (form.get("dob") or "").strip()
        gender_input = (form.get("gender") or "").strip()
        mobile = (form.get("mobile") or "").strip()
        pan_number_input = (form.get("pan_number") or "").strip()
        device_info = form.get("device_info")

        aadhaar_file = request.files.get("aadhaar")
        pan_file = request.files.get("pan")
        dl_file = request.files.get("driving_license")

        aadhaar_parsed = {}
        pan_parsed = {}
        dl_parsed = {}

        if aadhaar_file:
            res = ocr_try_rois_and_parse(
                aadhaar_file.stream, parse_aadhaar, lang="eng+hin"
            )
            aadhaar_parsed = res["best_parsed"]

        if pan_file:
            res = ocr_try_rois_and_parse(pan_file.stream, parse_pan, lang="eng")
            pan_parsed = res["best_parsed"]

        if dl_file:
            res = ocr_dl_full(dl_file.stream)
            dl_parsed = res["best_parsed"]

        fraud_score = 0
        reasons = []

        def add_name_check(label, a, b):
            nonlocal fraud_score
            if a and b:
                sim = name_similarity_score(a, b)
                sc = sim.get("score") or 0
                status = sim.get("status")
                if status == "mismatch":
                    fraud_score += 25
                    reasons.append(f"{label}: name mismatch (similarity {sc}%)")
                elif status == "review":
                    fraud_score += 10
                    reasons.append(f"{label}: partial match (similarity {sc}%)")
                else:
                    reasons.append(f"{label}: names consistent (similarity {sc}%)")

        add_name_check("User vs Aadhaar", user_name, aadhaar_parsed.get("name"))
        add_name_check("User vs PAN", user_name, pan_parsed.get("name"))
        add_name_check("Aadhaar vs PAN", aadhaar_parsed.get("name"), pan_parsed.get("name"))
        add_name_check("User vs DL", user_name, dl_parsed.get("name"))
        add_name_check("Aadhaar vs DL", aadhaar_parsed.get("name"), dl_parsed.get("name"))
        add_name_check("PAN vs DL", pan_parsed.get("name"), dl_parsed.get("name"))

        def normalize_dob_simple(d):
            if not d:
                return None
            return re.sub(r"[\/\.]", "-", d.strip())

        dob_user = normalize_dob_simple(dob_input)
        dob_aad = normalize_dob_simple(aadhaar_parsed.get("dob"))
        dob_pan = normalize_dob_simple(pan_parsed.get("dob"))

        dobs_list = [
            ("user", dob_user),
            ("aadhaar", dob_aad),
            ("pan", dob_pan),
        ]
        present_dobs = [(src, d) for src, d in dobs_list if d]

        if present_dobs:
            ref_src, ref_dob = present_dobs[0]
            mismatches = []
            near_matches = []

            for src, d in present_dobs[1:]:
                if d == ref_dob:
                    continue
                elif dob_near_equal(ref_dob, d):
                    near_matches.append((src, d))
                else:
                    mismatches.append((src, d))

            if mismatches:
                fraud_score += 20
                reasons.append(
                    "DOB mismatch across documents (excluding DL DOB): "
                    f"reference={ref_src}:{ref_dob}, mismatches={mismatches}, "
                    f"near_matches={near_matches}"
                )
            else:
                if near_matches:
                    reasons.append(
                        "DOB consistent across Aadhaar/PAN/user "
                        "(only minor OCR variations; DL DOB ignored): "
                        f"canonical={ref_dob}, near_matches={near_matches}"
                    )
                else:
                    reasons.append(f"DOB consistent (Aadhaar/PAN/user): {ref_dob}")

        pan_ocr = pan_parsed.get("pan_number")
        if (
            pan_number_input
            and pan_ocr
            and pan_number_input.upper().replace(" ", "")
            != pan_ocr.upper().replace(" ", "")
        ):
            fraud_score += 15
            reasons.append("PAN number from form does not match PAN card OCR")
        elif pan_number_input and pan_ocr:
            reasons.append("PAN number matches OCR")

        if mobile and not re.fullmatch(r"[6-9]\d{9}", mobile):
            fraud_score += 10
            reasons.append("Mobile number looks invalid for Indian format")

        if not aadhaar_file:
            fraud_score += 10
            reasons.append("Aadhaar not uploaded")
        if not pan_file:
            fraud_score += 10
            reasons.append("PAN not uploaded")

        fraud_score = max(0, min(100, fraud_score))

        if fraud_score >= 70:
            risk_level = "HIGH"
            decision = "REJECT"
        elif fraud_score >= 35:
            risk_level = "MEDIUM"
            decision = "REVIEW"
        else:
            risk_level = "LOW"
            decision = "APPROVE"

        log_record = {
            "timestamp": datetime.now().isoformat(),
            "user_name": user_name,
            "fraud_score": fraud_score,
            "risk_level": risk_level,
            "decision": decision,
            "device_info": device_info,
        }
        if verification_logs_collection is not None:
            verification_logs_collection.insert_one(log_record)
        else:
            fallback_logs.append(log_record)

        if risk_level == "HIGH":
            alert = {
                "timestamp": datetime.now().isoformat(),
                "user_name": user_name,
                "fraud_score": fraud_score,
                "reasons": reasons,
            }
            if alerts_collection is not None:
                alerts_collection.insert_one(alert)
            else:
                fallback_alerts.append(alert)

        # <<< NEW: write to Audit Trail >>>
        try:
            evt_type = "error" if risk_level == "HIGH" else ("warning" if risk_level == "MEDIUM" else "success")
            log_audit_event(
                event_type=evt_type,
                title="Fraud Verification",
                message=f"Fraud Score: {fraud_score}% | Risk: {risk_level} | Decision: {decision}",
                source="Fraud Engine",
                meta={
                    "user_name": user_name,
                    "risk_level": risk_level,
                    "fraud_score": fraud_score,
                },
            )
        except Exception as e:
            logger.exception("Failed to log audit event for /analyze: %s", e)

        return (
            jsonify(
                {
                    "fraud_score": fraud_score,
                    "risk_level": risk_level,
                    "decision": decision,
                    "reasons": reasons,
                    "aadhaar_parsed": aadhaar_parsed,
                    "pan_parsed": pan_parsed,
                    "dl_parsed": dl_parsed,
                }
            ),
            200,
        )

    except Exception as e:
        logger.exception("analyze failed")
        return jsonify({"error": str(e)}), 500


@app.route("/submit-kyc", methods=["POST"])
def submit_kyc():
    """
    Accepts:
      - user_name
      - dob
      - gender
      - aadhaar (file)
      - pan (file)
    """
    try:
        user_name = request.form.get("user_name", "unknown").strip()
        dob = request.form.get("dob", "").strip()
        gender = request.form.get("gender", "").strip()
        aadhaar_file = request.files.get("aadhaar")
        pan_file = request.files.get("pan")

        if not aadhaar_file or not pan_file:
            return jsonify({"error": "Missing file(s): aadhaar and pan files are required"}), 400

        aadhaar_out = ocr_try_rois_and_parse(
            aadhaar_file.stream, parse_aadhaar, lang="eng+hin"
        )
        pan_out = ocr_try_rois_and_parse(pan_file.stream, parse_pan, lang="eng")

        aadhaar_parsed = aadhaar_out["best_parsed"] or {}
        pan_parsed = pan_out["best_parsed"] or {}

        aadhaar_number = (
            request.form.get("aadhaar_number", "").strip()
            or aadhaar_parsed.get("aadhaar_number")
        )
        pan_number = (
            request.form.get("pan_number", "").strip()
            or pan_parsed.get("pan_number")
        )

        if not dob:
            dob = aadhaar_parsed.get("dob") or pan_parsed.get("dob") or ""
        if not gender:
            gender = aadhaar_parsed.get("gender") or ""

        missing = []
        if not dob:
            missing.append("dob")
        if not gender:
            missing.append("gender")
        if missing:
            return (
                jsonify(
                    {
                        "error": "Missing fields",
                        "missing": missing,
                        "note": "DOB/gender not provided and not readable from uploaded images",
                    }
                ),
                400,
            )

        similarity = None
        similarity_status = None
        if aadhaar_parsed.get("name") and pan_parsed.get("name"):
            sim = name_similarity_score(
                aadhaar_parsed["name"], pan_parsed.get("name")
            )
            similarity = sim.get("score")
            similarity_status = sim.get("status")

        aadhaar_masked = mask_aadhaar(aadhaar_number) if aadhaar_number else None
        pan_masked = mask_pan(pan_number) if pan_number else None

        rec = make_record(
            user_name,
            aadhaar_masked,
            pan_masked,
            aadhaar_ocr=aadhaar_parsed,
            pan_ocr=pan_parsed,
            verification={
                "similarity_score": similarity,
                "similarity_status": similarity_status,
            },
            fraud_result={},
            dob=dob,
            gender=gender,
        )

        if kyc_collection is not None:
            existing_docs = list(kyc_collection.find())
        else:
            existing_docs = list(fallback_db)

        rec["fraud_result"] = compute_fraud_result_for_new_kyc(
            rec, existing_docs, similarity_status
        )

        # <<< NEW: write to Audit Trail on KYC submission >>>
        try:
            risk_level = rec["fraud_result"].get("risk_level", "LOW")
            fraud_score = rec["fraud_result"].get("fraud_score", 0)
            evt_type = "error" if risk_level == "HIGH" else ("warning" if risk_level == "MEDIUM" else "success")
            log_audit_event(
                event_type=evt_type,
                title="KYC Submission",
                message=f"KYC saved for {user_name} | Risk: {risk_level} | Fraud Score: {fraud_score}",
                source="KYC Engine",
                meta={
                    "user_name": user_name,
                    "risk_level": risk_level,
                    "fraud_score": fraud_score,
                    "aadhaar_masked": aadhaar_masked,
                    "pan_masked": pan_masked,
                },
            )
        except Exception as e:
            logger.exception("Failed to log audit event for /submit-kyc: %s", e)

        if kyc_collection is not None:
            res = kyc_collection.insert_one(rec)
            saved = kyc_collection.find_one({"_id": res.inserted_id})
            return jsonify({"message": "KYC saved (mongo)", "record": convert_obj(saved)}), 200
        else:
            rec["_id"] = f"local-{len(fallback_db) + 1}"
            fallback_db.append(rec)
            return jsonify({"message": "KYC saved (fallback)", "record": rec}), 200
    except Exception as e:
        logger.exception("submit-kyc failed")
        return jsonify({"error": str(e)}), 500


@app.route("/get_kyc_data", methods=["GET"])
def get_kyc_data():
    try:
        if kyc_collection is not None:
            docs = list(kyc_collection.find().sort("timestamp", -1))
            docs = [convert_obj(d) for d in docs]
            return jsonify({"records": docs}), 200
        else:
            return jsonify({"records": fallback_db}), 200
    except Exception as e:
        logger.exception("get_kyc_data failed")
        return jsonify({"error": str(e)}), 500


# -------------------------
# NEW: KYC LIST ENDPOINT FOR FRONTEND TABLE
# -------------------------
@app.route("/kyc-list", methods=["GET"])
def kyc_list():
    """
    Backend for KycUpload.jsx:
    GET http://127.0.0.1:5000/kyc-list
    """
    try:
        if kyc_collection is not None:
            docs = list(kyc_collection.find().sort("timestamp", -1))
            docs = [convert_obj(d) for d in docs]
        else:
            docs = list(fallback_db)

        items = []
        for d in docs:
            fraud = d.get("fraud_result") or {}
            items.append(
                {
                    "id": str(d.get("_id")) if d.get("_id") is not None else None,
                    "user_name": d.get("user_name") or d.get("name") or "-",
                    "aadhaar_number": (
                        d.get("aadhaar_number")
                        or d.get("aadhaar_masked")
                        or None
                    ),
                    "pan_number": (
                        d.get("pan_number")
                        or d.get("pan_masked")
                        or None
                    ),
                    "status": d.get("status") or "Pending",
                    "fraud_score": fraud.get("fraud_score"),
                    "created_at": d.get("timestamp")
                    or d.get("created_at")
                    or None,
                }
            )

        return jsonify(items), 200

    except Exception as e:
        logger.exception("kyc_list failed")
        return jsonify({"error": str(e)}), 500


# -------------------------
# NEW: VERIFICATION DASHBOARD ENDPOINT
# -------------------------
@app.route("/verification-dashboard", methods=["GET"])
def verification_dashboard():
    try:
        if kyc_collection is not None:
            docs = list(kyc_collection.find().sort("timestamp", -1))
            docs = [convert_obj(d) for d in docs]
        else:
            docs = list(fallback_db)

        if not docs:
            summary = {
                "total_docs": 0,
                "valid_docs": 0,
                "high_risk": 0,
                "avg_fraud_score": 0.0,
                "risk_distribution": {
                    "valid": 0,
                    "medium": 0,
                    "high": 0,
                },
                "overall_risk": "No KYC submissions yet",
            }
            aadhaar_block = {
                "title": "Aadhaar Verification",
                "status": "No Aadhaar submitted",
                "fraud_score": 0,
                "risk_level": "Unknown",
                "reasons": [],
            }
            pan_block = {
                "title": "PAN Verification",
                "status": "No PAN submitted",
                "fraud_score": 0,
                "risk_level": "Unknown",
                "reasons": [],
            }
            return jsonify(
                {
                    "summary": summary,
                    "aadhaar": aadhaar_block,
                    "pan": pan_block,
                }
            ), 200

        total_docs = 0
        valid_docs = 0
        high_risk = 0
        fraud_scores = []
        dist = {"valid": 0, "medium": 0, "high": 0}

        for rec in docs:
            fraud = rec.get("fraud_result") or {}
            fs = float(fraud.get("fraud_score") or 0)
            rl_raw = (fraud.get("risk_level") or "").upper()

            fraud_scores.append(fs)

            doc_count = 0
            if rec.get("aadhaar_ocr"):
                doc_count += 1
            if rec.get("pan_ocr"):
                doc_count += 1
            if doc_count == 0:
                doc_count = 1

            total_docs += doc_count

            if rl_raw == "LOW":
                valid_docs += doc_count
                dist["valid"] += doc_count
            elif rl_raw == "HIGH":
                high_risk += doc_count
                dist["high"] += doc_count
            else:
                dist["medium"] += doc_count

        avg_fraud_score = mean(fraud_scores) if fraud_scores else 0.0

        if dist["high"] > 0:
            overall_risk = "High Risk – Immediate manual review required"
        elif dist["medium"] > 0:
            overall_risk = "Medium Risk – Manual review recommended"
        else:
            overall_risk = "Low Risk – Auto-approval possible"

        summary = {
            "total_docs": total_docs,
            "valid_docs": valid_docs,
            "high_risk": high_risk,
            "avg_fraud_score": avg_fraud_score,
            "risk_distribution": dist,
            "overall_risk": overall_risk,
        }

        latest = docs[0]
        latest_fraud = latest.get("fraud_result") or {}
        latest_fs = float(latest_fraud.get("fraud_score") or 0)
        rl_raw = (latest_fraud.get("risk_level") or "LOW").upper()

        human_rl = {
            "LOW": "Low",
            "MEDIUM": "Medium",
            "HIGH": "High",
        }.get(rl_raw, "Unknown")

        if rl_raw == "LOW":
            doc_status = "Valid Document"
        else:
            doc_status = "Invalid Document"

        flags = latest_fraud.get("flags") or []
        reasons = [str(f) for f in flags if f]
        if not reasons:
            if rl_raw == "LOW":
                reasons = ["No major anomalies detected in latest KYC submission."]
            elif rl_raw == "MEDIUM":
                reasons = ["Some checks require manual review for the latest KYC."]
            elif rl_raw == "HIGH":
                reasons = ["Multiple red flags detected in the latest KYC checks."]

        aadhaar_block = {
            "title": "Aadhaar Verification",
            "status": doc_status,
            "fraud_score": latest_fs,
            "risk_level": human_rl,
            "reasons": reasons,
        }

        pan_block = {
            "title": "PAN Verification",
            "status": doc_status,
            "fraud_score": latest_fs,
            "risk_level": human_rl,
            "reasons": reasons,
        }

        return jsonify(
            {
                "summary": summary,
                "aadhaar": aadhaar_block,
                "pan": pan_block,
            }
        ), 200

    except Exception as e:
        logger.exception("verification_dashboard failed")
        return jsonify({"error": str(e)}), 500


@app.route("/logs", methods=["GET"])
def get_logs():
    try:
        if verification_logs_collection is not None:
            docs = list(verification_logs_collection.find().sort("timestamp", -1))
            return jsonify({"logs": convert_obj(docs)}), 200
        else:
            return jsonify({"logs": fallback_logs}), 200
    except Exception as e:
        logger.exception("get_logs failed")
        return jsonify({"error": str(e)}), 500


@app.route("/alerts", methods=["GET"])
def get_alerts():
    try:
        if alerts_collection is not None:
            docs = list(alerts_collection.find().sort("timestamp", -1))
            return jsonify({"alerts": convert_obj(docs)}), 200
        else:
            return jsonify({"alerts": fallback_alerts}), 200
    except Exception as e:
        logger.exception("get_alerts failed")
        return jsonify({"error": str(e)}), 500


# -------------------------
# NEW: AUDIT TRAIL ENDPOINT FOR FRONTEND
# -------------------------
@app.route("/audit-trail", methods=["GET"])
def audit_trail():
    """
    Backend for AuditTrail.jsx
    GET http://127.0.0.1:5000/audit-trail

    Returns newest → oldest events:
    { "events": [ { id, type, title, message, source, timestamp, meta }, ... ] }
    """
    try:
        return jsonify({"events": list(AUDIT_EVENTS)}), 200
    except Exception as e:
        logger.exception("audit_trail failed")
        return jsonify({"error": str(e)}), 500


@app.route("/approve/<_id>", methods=["POST"])
def approve(_id):
    try:
        updated = False
        if kyc_collection is not None:
            kyc_collection.update_one(
                {"_id": ObjectId(_id)}, {"$set": {"status": "Approved"}}
            )
            updated = True
        else:
            for r in fallback_db:
                if r.get("_id") == _id:
                    r["status"] = "Approved"
                    updated = True
                    break

        if updated:
            # <<< NEW: log approve event >>>
            try:
                log_audit_event(
                    event_type="success",
                    title="KYC Approved",
                    message=f"KYC {_id} approved",
                    source="Backoffice",
                    meta={"record_id": _id},
                )
            except Exception as e:
                logger.exception("Failed to log audit event for approve: %s", e)

            return jsonify({"ok": True}), 200
        else:
            return jsonify({"error": "not found"}), 404
    except Exception as e:
        logger.exception("approve failed")
        return jsonify({"error": str(e)}), 500


@app.route("/reject/<_id>", methods=["POST"])
def reject(_id):
    try:
        updated = False
        if kyc_collection is not None:
            kyc_collection.update_one(
                {"_id": ObjectId(_id)}, {"$set": {"status": "Rejected"}}
            )
            updated = True
        else:
            for r in fallback_db:
                if r.get("_id") == _id:
                    r["status"] = "Rejected"
                    updated = True
                    break

        if updated:
            # <<< NEW: log reject event >>>
            try:
                log_audit_event(
                    event_type="error",
                    title="KYC Rejected",
                    message=f"KYC {_id} rejected",
                    source="Backoffice",
                    meta={"record_id": _id},
                )
            except Exception as e:
                logger.exception("Failed to log audit event for reject: %s", e)

            return jsonify({"ok": True}), 200
        else:
            return jsonify({"error": "not found"}), 404
    except Exception as e:
        logger.exception("reject failed")
        return jsonify({"error": str(e)}), 500


# -------------------------
# Run server
# -------------------------
if __name__ == "__main__":
    logger.info("Starting integration backend on 0.0.0.0:5000 (debug prints enabled)")
    app.run(host="0.0.0.0", port=5000, debug=True)
