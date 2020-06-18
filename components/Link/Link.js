import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import NextLink from "next/link";
import Button from "@material-ui/core/Button";
import IconButton from "@material-ui/core/IconButton";

const useStyles = makeStyles((theme) => ({
  navlink: {
    color: theme.palette.primary.main,
    textDecoration: "none",
    cursor: "pointer",
    "&:hover": {
      textDecoration: "underline",
    },
  },
}));

const Link = ({ to, variant = "contained", ...rest }) => {
  const { navLink } = useStyles();
  return variant === "link" ? (
    <NextLink className={navLink} href={to} {...rest} />
  ) : variant === "icon" ? (
    <NextLink href={to}>
      <IconButton {...rest} />
    </NextLink>
  ) : (
    <Button component={NextLink} href={to} {...rest}></Button>
  );
};

export default Link;
