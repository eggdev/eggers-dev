import React, { useLayoutEffect, useState } from "react";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import Fade from "@material-ui/core/Fade";

const LoadingContainer = ({ isLoading }) => {
  const [startFade, setStartFade] = useState(false);

  useLayoutEffect(() => {
    setTimeout(() => {
      setStartFade(!startFade);
    }, 1000);
  }, [startFade]);

  return (
    <Grid container justify="center" alignItems="center">
      <Fade in={isLoading} timeout={500}>
        <Typography variant="h4">Fetching from Heroku</Typography>
      </Fade>
      <Fade in={startFade} timeout={500}>
        <Typography variant="h4">.</Typography>
      </Fade>
      <Fade in={startFade} timeout={750}>
        <Typography variant="h4">.</Typography>
      </Fade>
      <Fade in={startFade} timeout={1000}>
        <Typography variant="h4">.</Typography>
      </Fade>
    </Grid>
  );
};

export default LoadingContainer;
