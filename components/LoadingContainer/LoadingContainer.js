import React, { useLayoutEffect, useState } from "react";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import Fade from "@material-ui/core/Fade";

const LoadingContainer = ({ isLoading }) => {
  const [isLoadingLong, setIsLoadingLong] = useState(false);
  const [startFade, setStartFade] = useState(false);

  useLayoutEffect(() => {
    setTimeout(() => {
      setIsLoadingLong(true);
    }, 500);
  }, [isLoading]);

  useLayoutEffect(() => {
    setTimeout(() => {
      setStartFade(!startFade);
    }, 1000);
  }, [startFade]);

  return (
    <Grid container justify="center" alignItems="center">
      <Fade in={isLoadingLong} timeout={500}>
        <Typography variant="h5">Fetching from Heroku</Typography>
      </Fade>
      <Fade in={startFade} timeout={500}>
        <Typography variant="h5">.</Typography>
      </Fade>
      <Fade in={startFade} timeout={750}>
        <Typography variant="h5">.</Typography>
      </Fade>
      <Fade in={startFade} timeout={1000}>
        <Typography variant="h5">.</Typography>
      </Fade>
    </Grid>
  );
};

export default LoadingContainer;
