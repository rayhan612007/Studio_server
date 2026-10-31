import express from 'express';
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import cors from 'cors';
const app = express()

app.use(express.json());
app.use(cors())
const port = 7000

const client = new MongoClient(process.env.BETTER_AUTH_URL_DB);

export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}
const mongoclient = await connectToMongoDB();
const database = mongoclient.db("studiodatabase");
const studiocollection = database.collection("studiocollection");

app.get('/', async (req, res) => {
    const data = await studiocollection.find().toArray();
    res.send(data)
})


app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})