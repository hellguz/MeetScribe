import React from "react";

export default function TemplateBadge({ type }: { type: string }) {
  return (
    <span className="border rounded px-2 py-0.5 text-xs bg-gray-100">
      {type}
    </span>
  );
}
