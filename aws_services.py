import boto3
import os
from typing import Optional
from botocore.config import Config

class AWSServices:
    """
    Handles auxiliary AWS services.
    Polly has been completely removed/commented out to rely purely on Amazon Nova Sonic.
    """
    def __init__(self):
        pass
        # region = os.getenv('AWS_REGION', 'us-east-1')
        # config = Config(connect_timeout=2.0, read_timeout=3.0, retries={'max_attempts': 1})
        # self.polly = boto3.client('polly', region_name=region, config=config)
        # self.voice_id = 'Matthew'

    def get_tts(self, text: str) -> Optional[bytes]:
        """Synthesizes text to speech using Amazon Polly (Commented out for native Nova Sonic)."""
        # return None — Polly disabled in favor of native Nova Sonic speech
        return None

# Singleton instance
try:
    aws_services = AWSServices()
except Exception as e:
    aws_services = None
