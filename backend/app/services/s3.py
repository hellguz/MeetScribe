import boto3
from botocore.client import Config
from app.config import settings

_s3 = boto3.client(
    "s3",
    endpoint_url=f"http://{settings.minio_endpoint}",
    aws_access_key_id=settings.minio_root_user,
    aws_secret_access_key=settings.minio_root_password,
    config=Config(signature_version="s3v4"),
    region_name="us-east-1",
)

def put_object(key: str, body: bytes):
    _s3.put_object(Bucket=settings.s3_bucket, Key=key, Body=body)

def stream(key: str):
    return _s3.get_object(Bucket=settings.s3_bucket, Key=key)["Body"]


