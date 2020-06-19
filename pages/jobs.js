import React from "react";
import Container from "@material-ui/core/Container";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import Fade from "@material-ui/core/Fade";
import JobListing from "../components/JobListing/JobListing";
import fetch from "isomorphic-unfetch";

const Jobs = ({ data }) => {
  return (
    <Fade in={true} timeout={250}>
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

Jobs.getInitialProps = async (csx) => {
  let res;
  if (csx.req) res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/jobs`);
  else res = await fetch("/api/jobs");
  const json = await res.json();
  return {
    data: json,
  };
};

export default Jobs;
