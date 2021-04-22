import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import Link from "../Link/Link";
import IconButton from "@material-ui/core/IconButton";
import Brightness6 from "@material-ui/icons/Brightness6";
import Fade from "@material-ui/core/Fade";
import Tooltip from "@material-ui/core/Tooltip";

const useStyles = makeStyles((theme) => ({
  iconButton: {
    background: theme.palette.primary.main,
    marginTop: theme.spacing(1),
    borderRadius: "25px",
    "&:hover": {
      background: theme.palette.primary.dark,
    },
  },
}));

const SpeedDialAction = ({
  to,
  name,
  RouteIcon,
  dialLength,
  toggleDarkMode,
  handleClick,
  index,
  open,
}) => {
  const { iconButton } = useStyles();

  const outIndex = dialLength - index;

  const timeoutObject = {
    enter: index === 0 ? 400 : index * 400,
    exit: outIndex === 0 ? 100 : outIndex * 100,
  };

  return to === "toggle" ? (
    <Fade in={open} timeout={timeoutObject}>
      <Tooltip className={iconButton} title={name} placement="left">
        <IconButton onClick={toggleDarkMode}>
          <Brightness6 />
        </IconButton>
      </Tooltip>
    </Fade>
  ) : (
    <Fade in={open} timeout={timeoutObject}>
      <Tooltip className={iconButton} title={name} placement="left">
        <div>
          <Link variant="icon" to={to} onClick={handleClick}>
            <RouteIcon />
          </Link>
        </div>
      </Tooltip>
    </Fade>
  );
};

export default SpeedDialAction;
