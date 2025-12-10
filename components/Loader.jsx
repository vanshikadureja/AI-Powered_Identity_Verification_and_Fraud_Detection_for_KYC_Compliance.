import { Loader2 } from "lucide-react";

export default function Loader({ text = "Verifying..." }) {
  return (
    <div className="flex flex-col items-center justify-center p-6">
      <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      <p className="mt-2 text-gray-600">{text}</p>
    </div>
  );
}
