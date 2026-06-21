from pinecone import Pinecone
from sentence_transformers import SentenceTransformer

# Initialize embedding model
model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

# Pinecone
pc = Pinecone(api_key="pcsk_2GLkK3_2U3D4L7KHWbvXVEpa9rKTS8L21Hjj3v9SnKyP9oLSaUqnHDgzSJkAg1pvChXTrq")
index = pc.Index("research-db")

# Text
text = """
Vision Language Models combine image understanding
and natural language processing capabilities.
"""

# Generate embedding
embedding = model.encode(text).tolist()

# Store in Pinecone
index.upsert(
    vectors=[
        {
            "id": "doc-1",
            "values": embedding,
            "metadata": {
                "text": text
            }
        }
    ]
)

print("Stored successfully")