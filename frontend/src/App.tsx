import React from "react";
import { Route, Routes, Navigate } from "react-router-dom";
import Record from "./pages/Record";
import Summary from "./pages/Summary";
import Checkout from "./pages/Checkout";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/record" replace />} />
      <Route path="/record" element={<Record />} />
      <Route path="/summary/:mid" element={<Summary />} />
      <Route path="/checkout" element={<Checkout />} />
    </Routes>
  );
}


