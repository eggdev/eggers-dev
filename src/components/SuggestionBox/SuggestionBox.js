import React, { useState } from "react";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import Filters from "../Filters/Filters";
import TextField from "@material-ui/core/TextField";
import Button from "@material-ui/core/Button";
const API_URL = window.API_URL;

const SuggestionBox = () => {
  const [thanks, setThanks] = useState(false);
  const [error, setError] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [selectedFilter, setSelectedFilter] = useState(null);
  const filterArray = ["React", "Python", "Raspberry Pi", "Other"];

  const getRandomIdea = () => {
    const ideaArray = [
      "Material UI Component Library",
      "Create React App CLI",
      "Video Chat with Twilio",
      "Magic Mirror",
    ];
    const randomIndex = Math.floor(Math.random() * ideaArray.length);
    return ideaArray[randomIndex];
  };

  const filterClick = (val) => {
    if (val === selectedFilter) setSelectedFilter(null);
    else setSelectedFilter(val);
  };

  const handleChange = ({ target }) => {
    const { value } = target;
    setInputVal(value);
  };

  const handleSubmit = async () => {
    if (!selectedFilter || !inputVal) {
      setError(true);
      return;
    }

    const req = await fetch(`${API_URL}/twilio`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: selectedFilter,
        idea: inputVal,
      }),
    });
    const res = await req.json();
    if (res.success) setThanks(true);
  };

  return (
    <Grid container direction="column" alignItems="center" justify="center">
      {!thanks ? (
        <>
          <Typography variant="h5" gutterBottom>
            What would you like me to build next?
          </Typography>
          {error && <Typography color="error">Please add some info</Typography>}
          <Filters
            selectedFilter={selectedFilter}
            setSelectedFilter={filterClick}
            filters={filterArray}
          />
          <TextField
            value={inputVal}
            onChange={handleChange}
            label="Brief Description"
            placeholder={`Brief Description (eg: ${getRandomIdea()})`}
            variant="outlined"
            fullWidth
            style={{ marginBottom: "1rem" }}
          />
          <Button onClick={handleSubmit} variant="contained">
            Send Idea
          </Button>
        </>
      ) : (
        <Typography variant="h3">Thanks for your input!</Typography>
      )}
    </Grid>
  );
};

export default SuggestionBox;
