import React from "react";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import Grow from "@material-ui/core/Grow";
// import Moment from "react-moment";

const JobListing = ({ jobData: job, index }) => {
  const companySplit = job.company.split("&").join("\n");
  return (
    <Grow in={true} timeout={(index + 1) * 500}>
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
            {/* <Moment format="MMM YYYY">{job.start_date}</Moment> */}
            &ndash;
            {/* <Moment format="MMM YYYY">{job.end_date}</Moment> */}
          </Typography>
          <Typography variant="body1">{job.location}</Typography>
        </Grid>
        <Grid item xs={12} sm={7}>
          <Typography variant="body1">{job.description}</Typography>
        </Grid>
      </Grid>
    </Grow>
  );
};

export default JobListing;
