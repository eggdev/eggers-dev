//https://github.com/the-road-to-learn-react/use-data-api/blob/master/src/index.js
import { useState, useEffect, useReducer } from "react";
import { setupRequestInfo } from "../utils/requestTypes";
const API = window.API_URL;

const fetchReducer = (state, action) => {
  switch (action.type) {
    case "FETCH_INIT":
      return { ...state, isLoading: true, isError: false };
    case "FETCH_SUCCESS":
      return {
        ...state,
        isLoading: false,
        isError: false,
        data: action.payload,
      };
    case "FETCH_FAILURE":
      return { ...state, isLoading: false, isError: true };
    default:
      throw new Error();
  }
};

const useFetch = (requestType) => {
  const requestParams = setupRequestInfo(requestType);
  const [requestOptions, setRequestOptions] = useState(requestParams);
  const [state, dispatch] = useReducer(fetchReducer, {
    isLoading: false,
    isError: false,
    data: [],
    errorData: false,
  });

  useEffect(() => {
    const { path } = requestOptions;
    let didCancel = false;
    const fetchData = async () => {
      dispatch({ type: "FETCH_INIT" });
      try {
        const result = await (
          await fetch(`${API}/${path}`, requestOptions)
        ).json();
        if (!didCancel) {
          dispatch({ type: "FETCH_SUCCESS", payload: result });
        }
      } catch (err) {
        if (!didCancel) {
          dispatch({ type: "FETCH_FAILURE", payload: err.response });
        }
      }
    };

    fetchData();
    return () => {
      didCancel = true;
    };
  }, [requestOptions]);

  return [state, setRequestOptions];
};

export default useFetch;
