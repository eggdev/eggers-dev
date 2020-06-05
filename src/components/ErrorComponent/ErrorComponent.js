import React from "react";
import Container from "@material-ui/core/Container";
import Typography from "@material-ui/core/Typography";
import CakeIcon from "@material-ui/icons/Cake";

const ErrorComponent = () => {
  return (
    <Container>
      <CakeIcon fontSize="large" />
      <Typography>Something went wrong!</Typography>
      <Typography>Make a wish for better times!</Typography>
    </Container>
  );
};

export default ErrorComponent;
