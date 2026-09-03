import os
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

async def clear_db():
    url = "mongodb+srv://krishnasaketh566_db_user:p988wgW0hnRD49rf@cluster0.cxxsqnn.mongodb.net/?appName=Cluster0"
    client = AsyncIOMotorClient(url)
    db = client["deepverify"]
    
    print("Clearing collections...")
    await db.users.drop()
    await db.invitations.drop()
    await db.sessions.drop()
    print("Atlas Database cleared!")

asyncio.run(clear_db())
