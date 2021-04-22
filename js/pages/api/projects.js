import nextConnect from "next-connect";
import middleware from "../../middleware/database";

const projects = nextConnect();

projects.use(middleware);

projects.get(async (req, res) => {
  const projects = await req.db.collection("projects").find({}).toArray();
  res.status = 200;
  const sorted = projects.sort((a, b) =>
    a.year_built < b.year_built ? 1 : -1
  );
  res.json(sorted);
});

export default projects;
