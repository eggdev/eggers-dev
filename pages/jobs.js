import React from "react";
import Container from "@material-ui/core/Container";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import Fade from "@material-ui/core/Fade";
import JobListing from "../components/JobListing/JobListing";
import LoadingContainer from "../components/LoadingContainer/LoadingContainer";
import useFetch from "../hooks/useFetch";

const Jobs = () => {
  const [{ data, isLoading, isError, errorData }] = useFetch("api/jobs");

  return (
    <Fade in={true} timeout={250}>
      <Container maxWidth="md">
        <Grid container item xs={12} direction="column" alignItems="center">
          <Typography gutterBottom={true} variant="h3">
            Job History
          </Typography>
          {isLoading ? (
            <LoadingContainer />
          ) : (
            <Grid container spacing={4}>
              {data.map((job, index) => {
                return <JobListing jobData={job} key={job._id} index={index} />;
              })}
            </Grid>
          )}
        </Grid>
      </Container>
    </Fade>
  );
};

export default Jobs;
