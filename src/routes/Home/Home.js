import React from "react";
import { makeStyles, useTheme } from "@material-ui/core/styles";
import Link from "../../components/Link/Link";
import SocialIcons from "../../components/SocialIcons/SocialIcons";
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
    <Fade in={true} timeout={1000}>
      <Grid
        className={fullHeight}
        container
        item
        xs={12}
        alignItems="center"
        justify="center"
        direction="column"
      >
        {matches ? (
          <>
            <Typography variant="h5" gutterBottom>
              Hey, I'm Brendan Eggers!
            </Typography>
            <Typography variant="h6">
              I make cool stuff with React.js.
            </Typography>
            <Typography variant="body2">
              Check out what I've built in my{" "}
              <Link className={navlink} to="/portfolio" variant="link">
                portfolio
              </Link>
              .
            </Typography>
            <Typography variant="body2">
              Follow the direction of my{" "}
              <Link className={navlink} to="/jobs" variant="link">
                career
              </Link>
              .
            </Typography>
          </>
        ) : (
          <>
            <Typography variant="h3" gutterBottom>
              Hey, I'm Brendan Eggers!
            </Typography>
            <Typography variant="h4">
              I make cool stuff with React.js.
            </Typography>
            <Typography variant="h5">
              Check out what I've built in my{" "}
              <Link className={navlink} to="/portfolio" variant="link">
                portfolio
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
            <Typography variant="h5" gutterBottom>
              See what's growing in the{" "}
              <Link className={navlink} to="/lab" variant="link">
                lab
              </Link>
              .
            </Typography>
          </>
        )}
        <Grid container item xs={12} justify="center" alignItems="center">
          <SocialIcons />
        </Grid>
      </Grid>
    </Fade>
  );
};

export default Home;
