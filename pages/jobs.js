import React from "react";
import fetch from "isomorphic-fetch";
import Container from "@material-ui/core/Container";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import Fade from "@material-ui/core/Fade";
import JobListing from "../components/JobListing/JobListing";

const Jobs = ({ data }) => {
  return (
    <Fade in={true} timeout={1000}>
      <Container maxWidth="md">
        <Grid container item xs={12} direction="column" alignItems="center">
          <Typography gutterBottom={true} variant="h3">
            Job History
          </Typography>
          <Grid container spacing={4}>
            {data.map((job, index) => {
              return <JobListing jobData={job} key={job._id} index={index} />;
            })}
          </Grid>
        </Grid>
      </Container>
    </Fade>
  );
};

Jobs.getInitialProps = async () => {
  const res = await fetch(`http://localhost:3000/api/jobs`);
  const json = await res.json();
  return {
    data: json,
  };
};

export default Jobs;
