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
import HighlightOff from "@material-ui/icons/HighlightOff";
import Grow from "@material-ui/core/Grow";
import useFetch from "../../hooks/useFetch";
import { makeStyles } from "@material-ui/core/styles";
import LoadingContainer from "../../components/LoadingContainer/LoadingContainer";
const useStyles = makeStyles((theme) => ({
  fullWidth: {
    width: "100%",
  },
}));

const Lab = () => {
  const { fullWidth } = useStyles();
  const [{ data: labs, isLoading }] = useFetch("lab");

  return (
    <Fade in={true} timeout={500}>
      <Grid
        style={{ margin: "0 auto" }}
        container
        item
        xs={12}
        md={6}
        alignItems="center"
        direction="column"
      >
        <Typography gutterBottom={true} variant="h3">
          Laboratory
        </Typography>
        {isLoading ? (
          <LoadingContainer />
        ) : (
          <>
            <List className={fullWidth}>
              <ListItem>
                <Typography variant="h5">In Progress</Typography>
              </ListItem>
              {labs.map((proj, index) => (
                <Grow key={proj._id} in={true} timeout={(index + 1) * 500}>
                  <ListItem
                    {...(proj.github !== "" && {
                      button: true,
                      onClick: () => window.open(`${proj.github}`),
                    })}
                  >
                    <ListItemAvatar>
                      <Avatar>
                        {proj.github !== "" ? <GitHub /> : <HighlightOff />}
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
          </>
        )}
      </Grid>
    </Fade>
  );
};

export default Lab;
