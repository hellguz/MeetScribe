import React from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import api from "../api/client";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBKEY!);

export default function Checkout() {
  const handleClick = async () => {
    const { data } = await api.post("/billing/checkout");
    window.location.href = data.url;
  };

  return (
    <div className="p-6 text-center space-y-4">
      <h1 className="text-3xl font-bold">Subscribe</h1>
      <p>Unlimited transcriptions • €3 / month</p>
      <Elements stripe={stripePromise}>
        <button
          className="bg-black text-white px-4 py-2 rounded"
          onClick={handleClick}
        >
          Continue to Stripe
        </button>
      </Elements>
    </div>
  );
}


