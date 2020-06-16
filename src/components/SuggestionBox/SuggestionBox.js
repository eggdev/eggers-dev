import React, { useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import Filters from "../Filters/Filters";
import TextField from "@material-ui/core/TextField";
import Button from "@material-ui/core/Button";

const useStyles = makeStyles((theme) => ({}));

const SuggestionBox = () => {
  const [inputVal, setInputVal] = useState("");
  const [selectedFilter, setSelectedFilter] = useState(null);
  const filterArray = ["React", "Python", "Raspberry Pi", "Else"];

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
    if (val == selectedFilter) setSelectedFilter(null);
    else setSelectedFilter(val);
  };

  const handleChange = ({ target }) => {
    const { value } = target;
    setInputVal(value);
  };

  const handleSubmit = () => {};

  return (
    <Grid container direction="column" alignItems="center" justify="center">
      <Typography variant="h5">
        What would you like me to build next?
      </Typography>
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
      <Button variant="contained">Send Idea</Button>
    </Grid>
  );
};

export default SuggestionBox;
