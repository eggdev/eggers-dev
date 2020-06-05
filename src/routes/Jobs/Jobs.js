import React, { useState, useEffect } from "react";
import Container from "@material-ui/core/Container";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import Moment from "react-moment";
import useFetch from "../../hooks/useFetch";
Moment.globalFormat = "MMM YYYY";

const Jobs = () => {
  const [{ data, isLoading, isError, errorData }] = useFetch("jobs");
  return (
    <Container maxWidth="md">
      <Grid container item xs={12} direction="column" alignItems="center">
        <Typography gutterBottom={true} variant="h3">
          Job History
        </Typography>
        <Grid container spacing={4}>
          {data.map((job) => {
            const companySplit = job.company.split("&").join("\n");
            return (
              <Grid container spacing={2} item xs={12} key={job._id}>
                <Grid item xs={12} sm={5}>
                  <Typography
                    style={{ whiteSpace: "pre-line" }}
                    variant="h5"
                    color="primary"
                  >
                    {companySplit}
                  </Typography>
                  <Typography variant="h6">{job.job_title}</Typography>
                  <Typography variant="body1">
                    <Moment parse="YYYY-MM-DD">{job.start_date}</Moment>
                    {" - "}
                    <Moment parse="YYYY-MM-DD">{job.end_date}</Moment>
                  </Typography>
                  <Typography variant="body1">{job.location}</Typography>
                </Grid>
                <Grid item xs={12} sm={7}>
                  <Typography variant="body1">{job.description}</Typography>
                </Grid>
              </Grid>
            );
          })}
        </Grid>
      </Grid>
    </Container>
  );
};

export default Jobs;
