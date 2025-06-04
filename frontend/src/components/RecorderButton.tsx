import React from "react";

export default function RecorderButton({
  label,
  onClick,
  danger = false
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-6 py-3 rounded text-white ${
        danger ? "bg-red-600" : "bg-green-600"
      }`}
    >
      {label}
    </button>
  );
}


