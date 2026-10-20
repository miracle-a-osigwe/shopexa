import boto3

client = boto3.client('bedrock', region_name='us-east-1')
try:
    response = client.list_foundation_models()
    nova_models = [m['modelId'] for m in response['modelSummaries'] if 'nova' in m['modelId'].lower()]
    print("Found Nova Models:")
    for m in nova_models:
        print(f" - {m}")
except Exception as e:
    print(f"Error listing models: {e}")
