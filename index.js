const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require("mongodb");
const port = process.env.PORT || 5000;

// ENV config
dotenv.config();

// App init
const app = express();
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.eyqagy8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  const db = client.db("bazaar-track");
  const usersCollection = db.collection("users");

  //   user related api
  //   app.get("/users", async (req, res) => {
  //     try {
  //     } catch (err) {
  //       res.status(500).send({ message: err.message });
  //     }
  //   });

  app.get("/users", async (req, res) => {
    try {
      const users = await usersCollection.find().sort({ createdAt: -1 });
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/users", async (req, res) => {
    console.log("REQ BODY:", req.body);
    try {
      const { name, email, photoURL, provider } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Check if user already exists
      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        return res
          .status(200)
          .send({ message: "User already exists", inserted: false });
      }

      const newUser = {
        name,
        email,
        photoURL,
        provider: provider || "firebase",
        role: "user",
        createdAt: new Date(),
        lastLogin: new Date(),
      };

      const result = await usersCollection.insertOne(newUser);
      res.send({ ...result, inserted: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  try {
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("bazaar track server running");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
