import React from "react";
import Fade from "@material-ui/core/Fade";
import Typography from "@material-ui/core/Typography";
import Grid from "@material-ui/core/Grid";
import List from "@material-ui/core/List";
import Avatar from "@material-ui/core/Avatar";
import ListItem from "@material-ui/core/ListItem";
import ListItemText from "@material-ui/core/ListItemText";
import ListItemAvatar from "@material-ui/core/ListItemAvatar";
import Divider from "@material-ui/core/Divider";
import GitHub from "@material-ui/icons/GitHub";
import Grow from "@material-ui/core/Grow";
import useFetch from "../../hooks/useFetch";

const Lab = () => {
  const [{ data: labs }] = useFetch("lab");

  return (
    <Fade in={true} timeout={500}>
      <Grid container item xs={12} alignItems="center" direction="column">
        <Typography gutterBottom={true} variant="h3">
          Work in Progress
        </Typography>
        <Typography variant="h6">Cool things I'm building</Typography>
        <List>
          {labs.map((proj, index) => (
            <Grow in={true} timeout={(index + 1) * 500}>
              <ListItem
                key={proj._id}
                button
                onClick={() => window.open(`${proj.github}`)}
              >
                <ListItemAvatar>
                  <Avatar>
                    <GitHub />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={proj.title}
                  secondary={proj.description}
                />
                <Divider />
              </ListItem>
            </Grow>
          ))}
        </List>
      </Grid>
    </Fade>
  );
};

export default Lab;
