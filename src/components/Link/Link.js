import React from "react";
import { Link as RouterLink } from "react-router-dom";
import Button from "@material-ui/core/Button";
import IconButton from "@material-ui/core/IconButton";

const Link = ({ to, variant = "contained", ...rest }) => {
  return variant === "link" ? (
    <RouterLink to={to} {...rest} />
  ) : variant === "icon" ? (
    <RouterLink to={to}>
      <IconButton {...rest} />
    </RouterLink>
  ) : (
    <Button component={RouterLink} to={to} {...rest}></Button>
  );
};

export default Link;
