import asyncio
import os
from aws_sdk_bedrock_runtime.client import AsyncBedrockRuntimeClient
from aws_sdk_bedrock_runtime.models import InvokeModelWithBidirectionalStreamOperationInput

async def main():
    try:
        client = AsyncBedrockRuntimeClient(region="us-east-1")
        stream_response = await client.invoke_model_with_bidirectional_stream(
            InvokeModelWithBidirectionalStreamOperationInput(model_id="amazon.nova-2-sonic-v1:0")
        )
        print("Success! Sonic connected:", stream_response)
    except Exception as e:
        print("Failed:", e)

asyncio.run(main())
