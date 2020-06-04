import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { Button } from "@material-ui/core";

const Link = ({ to, variant = "contained", children }) => {
  return (
    <Button component={RouterLink} to={to}>
      {children}
    </Button>
  );
};

export default Link;
