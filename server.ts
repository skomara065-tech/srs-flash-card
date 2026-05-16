import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";

// 1. Read the service account key explicitly
const serviceAccountPath = path.resolve('./serviceAccountKey.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

// 2. Initialize Firebase Admin with explicit credentials
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: "gen-lang-client-0936895099" // Force the correct project
  });
}

/**
 * Option A: Fetching tokens from Firestore 'users' collection in batches of 500
 * using `messaging().sendEachForMulticast()`.
 * 
 * PROS:
 * - Highly targeted: You have full control over who gets the message.
 * - Reporting: You get detailed success/failure lists (good for cleaning up dead tokens).
 * 
 * CONS:
 * - Scalability bottleneck: Requires fetching thousands of DB documents first.
 * - Slower execution time: Need to manually batch requests in chunks of 500.
 */
export async function broadcastNotificationToAll_OptionA(title: string, body: string) {
  const db = getFirestore("ai-studio-ddda2213-6a6e-4fbc-8b69-b044fc83e9ab");
  const usersRef = db.collection('users');
  const snapshot = await usersRef.where('fcmToken', '!=', null).get();

  const tokens: string[] = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.fcmToken) {
      tokens.push(data.fcmToken);
    }
  });

  if (tokens.length === 0) {
    console.log("No FCM tokens found.");
    return;
  }

  const payload = { notification: { title, body } };

  // Firebase allows max 500 tokens per multicast
  let successCount = 0;
  for (let i = 0; i < tokens.length; i += 500) {
    const batchTokens = tokens.slice(i, i + 500);
    const response = await admin.messaging().sendEachForMulticast({
      tokens: batchTokens,
      ...payload
    });
    successCount += response.successCount;
    // (Optional) Here you would also remove failed tokens using response.responses
  }
  
  console.log(`Broadcast (Option A) sent: ${successCount} successful.`);
}

/**
 * Option B: Subscribing device tokens to an 'all_users' topic 
 * using `messaging().send({ topic: 'all_users' })`.
 * 
 * PROS:
 * - Massive Scalability: O(1) backend cost. You send exactly 1 payload to Google.
 * - Extremely fast server response.
 * 
 * CONS:
 * - Requires clients to proactively subscribe to the topic via the SDK.
 * - Granular tracking: Harder to know exactly which devices successfully received the message.
 */
export async function broadcastNotificationToAll_OptionB(title: string, body: string) {
  const topic = 'all_users';
  const payload = {
    notification: { title, body },
    topic: topic,
  };

  try {
    const response = await admin.messaging().send(payload);
    console.log(`Broadcast (Option B) sent to topic ${topic}:`, response);
  } catch (error) {
    console.error("Error broadcasting to topic:", error);
  }
}

// Wrapper pointing to whichever implementation fits the current scale
export async function broadcastNotificationToAll(title: string, body: string) {
  // We default to Option A for direct token targeting since the frontend 
  // currently saves the token to the users collection. If transitioning to Topics,
  // we would use Option B and ensure the client SDK signs up using subscribeToTopic()
  return broadcastNotificationToAll_OptionA(title, body);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Basic middleware
  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.post("/api/broadcast", async (req, res) => {
    try {
      const { title, body } = req.body;
      if (!title || !body) {
        return res.status(400).json({ error: "Missing title or body" });
      }
      
      await broadcastNotificationToAll(title, body);
      res.json({ success: true, message: "Broadcast notifications sent." });
    } catch (error: any) {
      console.error("Error sending broadcast:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to send broadcast" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve static files from dist
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
