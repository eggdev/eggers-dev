import React from "react";
import NextLink from "next/link";
import Button from "@material-ui/core/Button";
import IconButton from "@material-ui/core/IconButton";

const Link = ({ to, variant = "contained", ...rest }) => {
  return variant === "link" ? (
    <NextLink href={to} {...rest} />
  ) : variant === "icon" ? (
    <NextLink href={to}>
      <IconButton {...rest} />
    </NextLink>
  ) : (
    <Button component={NextLink} href={to} {...rest}></Button>
  );
};

export default Link;
