import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { Button } from "@material-ui/core";

const Link = ({ to, variant = "contained", ...rest }) => {
  return variant === "link" ? (
    <RouterLink to={to} {...rest} />
  ) : (
    <Button component={RouterLink} to={to} {...rest}></Button>
  );
};

export default Link;
