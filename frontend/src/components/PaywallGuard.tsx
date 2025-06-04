import React, { PropsWithChildren, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";

export default function PaywallGuard({ children }: PropsWithChildren) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/me");
        setAllowed(data.subscription_active);
        if (!data.subscription_active) navigate("/checkout");
      } catch {
        navigate("/checkout");
      }
    })();
  }, [navigate]);

  if (allowed === null) return null;
  return <>{children}</>;
}


