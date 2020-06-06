import React from "react";
import Container from "@material-ui/core/Container";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import Fade from "@material-ui/core/Fade";
import JobListing from "../../components/JobListing/JobListing";
import LoadingContainer from "../../components/LoadingContainer/LoadingContainer";
import ErrorComponent from "../../components/ErrorComponent/ErrorComponent";
import useFetch from "../../hooks/useFetch";

const Jobs = () => {
  const [{ data, isLoading, isError, errorData }] = useFetch("jobs");
  return (
    <Fade in={true} timeout={1000}>
      <Container maxWidth="md">
        <Grid container item xs={12} direction="column" alignItems="center">
          <Typography gutterBottom={true} variant="h3">
            Job History
          </Typography>
          {isLoading ? (
            <LoadingContainer isLoading={isLoading} />
          ) : isError ? (
            <ErrorComponent errorData={errorData} />
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
