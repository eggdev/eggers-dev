import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import Link from "../Link/Link";
import IconButton from "@material-ui/core/IconButton";
import Brightness6 from "@material-ui/icons/Brightness6";
import Grow from "@material-ui/core/Grow";
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
  toggleDarkMode,
  handleClick,
  index,
}) => {
  const { iconButton } = useStyles();
  return to === "toggle" ? (
    <Grow in={true} timeout={index === 0 ? 500 : index * 500}>
      <Tooltip className={iconButton} title={name} placement="left">
        <IconButton onClick={toggleDarkMode}>
          <Brightness6 />
        </IconButton>
      </Tooltip>
    </Grow>
  ) : (
    <Grow in={true} timeout={index === 0 ? 500 : index * 500}>
      <Tooltip className={iconButton} title={name} placement="left">
        <div>
          <Link variant="icon" to={to} onClick={handleClick}>
            <RouteIcon />
          </Link>
        </div>
      </Tooltip>
    </Grow>
  );
};

export default SpeedDialAction;
