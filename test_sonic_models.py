import asyncio
import os
import dotenv

dotenv.load_dotenv()
from smithy_aws_core.identity.static import StaticCredentialsResolver
from smithy_aws_core.identity import AWSCredentialsIdentity
from aws_sdk_bedrock_runtime.client import (
    AsyncBedrockRuntimeClient,
    InvokeModelWithBidirectionalStreamOperationInput,
)
from aws_sdk_bedrock_runtime.config import AsyncBedrockRuntimeConfig
from smithy_http.aio.crt import AWSCRTHTTPClient


async def test_invoke():
    region = os.getenv("AWS_REGION", "us-east-1")
    key = os.getenv("AWS_ACCESS_KEY_ID", "")
    secret = os.getenv("AWS_SECRET_ACCESS_KEY", "")
    token = os.getenv("AWS_SESSION_TOKEN", None)
    identity = AWSCredentialsIdentity(
        access_key_id=key, secret_access_key=secret, session_token=token
    )
    resolver = StaticCredentialsResolver(identity=identity)
    config = await AsyncBedrockRuntimeConfig.resolve(
        endpoint_uri=f"https://bedrock-runtime.{region}.amazonaws.com",
        region=region,
        transport=AWSCRTHTTPClient(),
        aws_credentials_identity_resolver=resolver,
    )
    client = AsyncBedrockRuntimeClient(config=config)
    stream_response = await client.invoke_model_with_bidirectional_stream(
        InvokeModelWithBidirectionalStreamOperationInput(
            model_id="amazon.nova-2-5-sonic"
        )
    )
    print("Invoke succeeded:", type(stream_response))
    await stream_response.close()


asyncio.run(test_invoke())
