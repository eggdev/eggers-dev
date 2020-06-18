import React from "react";
import Fade from "@material-ui/core/Fade";
import Grid from "@material-ui/core/Grid";
import SuggestionBox from "../components/SuggestionBox/SuggestionBox";

const Lab = () => {
  return (
    <Fade in={true} timeout={500}>
      <Grid container alignItems="center" justify="center">
        <Grid item xs={12} md={8}>
          <SuggestionBox />
        </Grid>
      </Grid>
    </Fade>
  );
};

export default Lab;
