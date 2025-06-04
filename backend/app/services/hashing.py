import hashlib

def sha256_digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


