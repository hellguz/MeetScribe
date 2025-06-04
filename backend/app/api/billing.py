import stripe
from fastapi import APIRouter, Header, HTTPException, Request

from app.config import settings

router = APIRouter()
stripe.api_key = settings.stripe_secret_key

@router.post("/stripe/webhook")
async def webhook(request: Request, stripe_signature: str = Header(None)):
    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(
            payload, stripe_signature, settings.stripe_webhook_secret
        )
    except stripe.error.SignatureVerificationError:
        raise HTTPException(400, "bad sig")

    # TODO: handle event.type and update DB
    return {"ok": True}


