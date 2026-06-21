from pinecone import Pinecone
from sentence_transformers import SentenceTransformer


PINECONE_API_KEY = "pcsk_2GLkK3_2U3D4L7KHWbvXVEpa9rKTS8L21Hjj3v9SnKyP9oLSaUqnHDgzSJkAg1pvChXTrq"
INDEX_NAME = "research-db"


print("Loading embedding model...")
model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


pc = Pinecone(api_key=PINECONE_API_KEY)
index = pc.Index(INDEX_NAME)


query = "What is a VLM?"

query_embedding = model.encode(
    f"query: {query}",
    normalize_embeddings=True
).tolist()

results = index.query(
    vector=query_embedding,
    top_k=5,
    include_metadata=True
)

print(f"\nQuery: {query}")
print("=" * 80)

matches = results.get("matches", [])

if not matches:
    print("No results found.")
else:
    for i, match in enumerate(matches, start=1):
        score = match["score"]

        metadata = match.get("metadata", {})
        text = metadata.get("text", "No text available")

        print(f"\nResult #{i}")
        print(f"Similarity Score: {score:.4f}")
        print("-" * 80)
        print(text[:1000])  # print first 1000 chars
        print("-" * 80)