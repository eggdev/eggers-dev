import React from "react";
import Container from "@material-ui/core/Container";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
const Home = () => {
  return (
    <Grid
      container
      item
      xs={12}
      alignItems="center"
      direction="column"
      minHeight="100%"
    >
      <Typography variant="h3">Hey, I'm Brendan Eggers</Typography>
      <Typography variant="h5">
        I'm a Frontend Developer with a focus in React.js.
      </Typography>
      <Typography variant="h5">
        Check out the sites I've built in my portfolio.
      </Typography>
      <Typography variant="h5">See what I'm working on in the lab.</Typography>
      <Typography variant="h5">
        Feel free to grab some time on my calendar.
      </Typography>
    </Grid>
  );
};

export default Home;
