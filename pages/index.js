import React from "react";
import { makeStyles, useTheme } from "@material-ui/core/styles";
import Link from "../components/Link/Link";
import SocialIcons from "../components/SocialIcons/SocialIcons";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import Fade from "@material-ui/core/Fade";
import useMediaQuery from "@material-ui/core/useMediaQuery";

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
  const theme = useTheme();
  const { fullHeight, navlink } = useStyles();
  const matches = useMediaQuery(theme.breakpoints.down("xs"));

  return (
    <Fade in={true} timeout={250}>
      <Grid
        className={fullHeight}
        container
        item
        xs={12}
        alignItems="center"
        justify="center"
        direction="column"
      >
        <Typography variant={matches ? "h5" : "h3"} gutterBottom>
          Hey, I'm Brendan Eggers!
        </Typography>
        <Typography variant={matches ? "h6" : "h4"}>
          I make cool stuff with React.js.
        </Typography>
        <Typography variant={matches ? "body2" : "h5"}>
          Check out what I've built in my{" "}
          <Link to="/portfolio" variant="link">
            <a className={navlink}>portfolio</a>
          </Link>
          .
        </Typography>
        <Typography variant={matches ? "body2" : "h5"}>
          Follow the direction of my{" "}
          <Link to="/jobs" variant="link">
            <a className={navlink}>career</a>
          </Link>
          .
        </Typography>
        <Typography variant={matches ? "body2" : "h5"} gutterBottom>
          Send me project ideas in the{" "}
          <Link to="/lab" variant="link">
            <a className={navlink}>lab</a>
          </Link>
          .
        </Typography>
        <Grid container item xs={12} justify="center" alignItems="center">
          <SocialIcons />
        </Grid>
      </Grid>
    </Fade>
  );
};

export default Home;
