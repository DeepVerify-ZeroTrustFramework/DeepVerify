import os
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

async def clear_db():
    url = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
    client = AsyncIOMotorClient(url)
    db = client["deepverify"]
    
    print("Clearing collections...")
    await db.users.drop()
    await db.invitations.drop()
    await db.sessions.drop()
    print("Atlas Database cleared!")

asyncio.run(clear_db())
