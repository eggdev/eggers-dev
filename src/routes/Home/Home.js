import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import Link from "../../components/Link/Link";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";

const useStyles = makeStyles((theme) => ({
  fullHeight: {
    minHeight: "85vh",
  },
  navlink: {
    color: theme.palette.primary.main,
    textDecoration: "none",
    cursor: "pointer",
    "&:hover": {
      textDecoration: "underline",
    },
  },
}));

const Home = () => {
  const { fullHeight, navlink } = useStyles();
  return (
    <Grid
      className={fullHeight}
      container
      item
      xs={12}
      alignItems="center"
      justify="center"
      direction="column"
    >
      <Typography variant="h3">Hey, I'm Brendan Eggers!</Typography>
      <Typography variant="h5">
        I'm a Frontend Engineer focused in React.js.
      </Typography>
      <Typography variant="h5">
        Check out what I've built in my{" "}
        <Link className={navlink} to="/portfolio" variant="link">
          portfolio
        </Link>
        .
      </Typography>
      <Typography variant="h5">
        See what I've got cooking in the{" "}
        <Link className={navlink} to="/lab" variant="link">
          lab
        </Link>
        .
      </Typography>
      <Typography variant="h5">
        Follow the direction of my{" "}
        <Link className={navlink} to="/jobs" variant="link">
          career
        </Link>
        .
      </Typography>
      <Grid container item xs={12}></Grid>
    </Grid>
  );
};

export default Home;
