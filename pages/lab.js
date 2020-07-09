import React from "react";
import { withStyles } from "@material-ui/core/styles";
import Fade from "@material-ui/core/Fade";
import Grid from "@material-ui/core/Grid";
import SuggestionBox from "../components/SuggestionBox/SuggestionBox";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import ListItemText from "@material-ui/core/ListItemText";
import Typography from "@material-ui/core/Typography";
import LinearProgress from "@material-ui/core/LinearProgress";
import fetch from "isomorphic-unfetch";

const BorderLinearProgress = withStyles((theme) => ({
  root: {
    height: 10,
    borderRadius: 5,
    width: 100,
    marginLeft: 10,
  },
  colorPrimary: {
    backgroundColor:
      theme.palette.grey[theme.palette.type === "light" ? 200 : 700],
  },
  bar: {
    borderRadius: 5,
    backgroundColor: theme.palette.primary.main,
  },
}))(LinearProgress);

const Lab = ({ data }) => {
  return (
    <Fade in={true} timeout={250}>
      <Grid container alignItems="center" justify="center">
        <Grid item xs={12} md={8}>
          <SuggestionBox />
        </Grid>
        <Grid
          container
          item
          xs={12}
          md={8}
          alignItems="center"
          direction="column"
        >
          <Typography variant="h6">How I'm Growing</Typography>
          <List>
            {data.map((tech) => (
              <ListItem key={tech.name.toLowerCase()}>
                <ListItemText primary={tech.name} />
                <BorderLinearProgress
                  variant="determinate"
                  value={tech.progress}
                />
              </ListItem>
            ))}
          </List>
        </Grid>
      </Grid>
    </Fade>
  );
};

export default Lab;

export async function getStaticProps() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning`);
  const json = await res.json();
  return {
    props: {
      data: json,
    },
  };
}
