import nextConnect from "next-connect";
import middleware from "../../middleware/database";

const jobs = nextConnect();

jobs.use(middleware);

jobs.get(async (req, res) => {
  const jobs = await req.db.collection("jobs").find({}).toArray();
  res.status = 200;
  res.json(jobs);
});

export default jobs;
