import nextConnect from "next-connect";
import middleware from "../../middleware/database";

const learning = nextConnect();

learning.use(middleware);

learning.get(async (req, res) => {
  const data = await req.db.collection("learning").find({}).toArray();
  res.status = 200;
  const sorted = data.sort((a, b) => (a.progress < b.progress ? 1 : -1));
  res.json(sorted);
});

export default learning;
