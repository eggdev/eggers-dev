const accountSid = process.env.NEXT_PUBLIC_ACCOUNT_SID;
const authToken = process.env.NEXT_PUBLIC_TWILIO_TOKEN;
const client = require("twilio")(accountSid, authToken);

export default (req, res) => {
  const getTextContent = () => {
    const { type, idea } = req.body;
    return `${type}: ${idea}`;
  };
  const textMessage = getTextContent();

  if (req.body) {
    client.messages
      .create({
        body: textMessage,
        from: "+12286419593",
        to: "+19149073990",
      })
      .then(() => {
        return res.json({ ...req.body, success: true });
      })
      .done();
  }
};
