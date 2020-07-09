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

const Lab = () => {
  const learningList = [
    {
      name: "React",
      progress: 90,
    },
    {
      name: "Redux",
      progress: 90,
    },
    {
      name: "Next.js",
      progress: 70,
    },
    {
      name: "MongoDB",
      progress: 70,
    },
    {
      name: "Flask",
      progress: 55,
    },
    {
      name: "Docker",
      progress: 25,
    },
    {
      name: "Redwood.js",
      progress: 10,
    },
    {
      name: "GraphQL",
      progress: 10,
    },
    {
      name: "Redis",
      progress: 0,
    },
  ];
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
            {learningList.map((tech) => (
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
